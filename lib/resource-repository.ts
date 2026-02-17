import "server-only"

import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"

import { ensureSchema, getDb } from "@/lib/db"
import {
  resourceAuditLogs,
  resourceCardTags,
  resourceCards,
  resourceCategories,
  resourceLinks,
  resourceTags,
} from "@/lib/db-schema"
import { getFaviconUrlsByHostnames, upsertFaviconCache } from "@/lib/favicon-repository"
import { hostnameFromUrl, resolveFaviconUrl, uniqueHostnames } from "@/lib/favicon-service"
import type {
  ResourceAuditAction,
  ResourceAuditActor,
  ResourceAuditLogEntry,
  ResourceCard,
  ResourceCategory,
  ResourceInput,
} from "@/lib/resources"

const DEFAULT_RESOURCE_CATEGORY_NAME = "General"
const FALLBACK_RESOURCE_CATEGORY_NAME = "Uncategorized"

export class ResourceNotFoundError extends Error {
  constructor(id: string) {
    super(`Resource ${id} was not found.`)
    this.name = "ResourceNotFoundError"
  }
}

export class ResourceCategoryNotFoundError extends Error {
  constructor(id: string) {
    super(`Category ${id} was not found.`)
    this.name = "ResourceCategoryNotFoundError"
  }
}

export class ResourceCategoryAlreadyExistsError extends Error {
  constructor(name: string) {
    super(`Category ${name} already exists.`)
    this.name = "ResourceCategoryAlreadyExistsError"
  }
}

interface ResourceCategoryRow {
  id: string
  name: string
  symbol: string | null
  createdAt: Date | string
  updatedAt: Date | string
}

interface ResourceJoinRow {
  resourceId: string
  resourceCategory: string
  resourceDeletedAt: Date | string | null
  linkId: string | null
  linkUrl: string | null
  linkLabel: string | null
  linkNote: string | null
}

interface ResourceAuditJoinRow {
  logId: string
  logResourceId: string
  logAction: string
  logActorUserId: string | null
  logActorIdentifier: string
  logCreatedAt: Date | string
  resourceCategory: string
}

interface ResourceTagJoinRow {
  resourceId: string
  tagName: string
}

function normalizeTimestamp(value: Date | string | null): string | null {
  if (!value) {
    return null
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  return value
}

function normalizeCategoryName(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeCategorySymbol(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null
  }

  const normalized = value.trim()
  if (!normalized) {
    return null
  }

  return normalized.slice(0, 16)
}

function normalizeTagName(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 40)
}

function normalizeAuditAction(value: string): ResourceAuditAction {
  return value === "restored" ? "restored" : "archived"
}

function normalizeCategoryRow(row: ResourceCategoryRow): ResourceCategory {
  return {
    id: row.id,
    name: normalizeCategoryName(row.name),
    symbol: normalizeCategorySymbol(row.symbol),
    createdAt: normalizeTimestamp(row.createdAt) ?? new Date(0).toISOString(),
    updatedAt: normalizeTimestamp(row.updatedAt) ?? new Date(0).toISOString(),
  }
}

function readErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null
  }

  if ("code" in error && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code
  }

  if (
    "cause" in error &&
    typeof (error as { cause?: unknown }).cause === "object" &&
    (error as { cause?: unknown }).cause !== null &&
    "code" in (error as { cause: { code?: unknown } }).cause &&
    typeof (error as { cause: { code?: unknown } }).cause.code === "string"
  ) {
    return (error as { cause: { code: string } }).cause.code
  }

  return null
}

function isUniqueViolation(error: unknown): boolean {
  return readErrorCode(error) === "23505"
}

function normalizeAuditActor(actor?: ResourceAuditActor): {
  actorUserId: string | null
  actorIdentifier: string
} {
  const actorUserId = actor?.userId?.trim() || null
  const normalizedIdentifier = actor?.identifier?.trim().toLowerCase()
  const fallbackIdentifier = actorUserId ?? "unknown"

  return {
    actorUserId,
    actorIdentifier: (normalizedIdentifier || fallbackIdentifier).slice(0, 320),
  }
}

async function appendAuditLog(
  resourceId: string,
  action: ResourceAuditAction,
  actor?: ResourceAuditActor
) {
  const db = getDb()
  const { actorUserId, actorIdentifier } = normalizeAuditActor(actor)

  await db.insert(resourceAuditLogs).values({
    resourceId,
    action,
    actorUserId,
    actorIdentifier,
  })
}

function mapRowsToResources(rows: ResourceJoinRow[]): ResourceCard[] {
  const resourcesById = new Map<string, ResourceCard>()
  const orderedResources: ResourceCard[] = []

  for (const row of rows) {
    let resource = resourcesById.get(row.resourceId)

    if (!resource) {
      resource = {
        id: row.resourceId,
        category: row.resourceCategory,
        tags: [],
        deletedAt: normalizeTimestamp(row.resourceDeletedAt),
        links: [],
      }
      resourcesById.set(row.resourceId, resource)
      orderedResources.push(resource)
    }

    if (row.linkId && row.linkUrl && row.linkLabel) {
      resource.links.push({
        id: row.linkId,
        url: row.linkUrl,
        label: row.linkLabel,
        note: row.linkNote,
      })
    }
  }

  return orderedResources
}

async function listTagsForResourceIds(
  resourceIds: string[]
): Promise<Map<string, string[]>> {
  const tagsByResourceId = new Map<string, string[]>()
  if (resourceIds.length === 0) {
    return tagsByResourceId
  }

  const db = getDb()
  const rows = await db
    .select({
      resourceId: resourceCardTags.resourceId,
      tagName: resourceTags.name,
    })
    .from(resourceCardTags)
    .innerJoin(resourceTags, eq(resourceCardTags.tagId, resourceTags.id))
    .where(inArray(resourceCardTags.resourceId, resourceIds))
    .orderBy(
      asc(resourceCardTags.resourceId),
      asc(sql`lower(${resourceTags.name})`)
    )

  for (const row of rows as ResourceTagJoinRow[]) {
    const existing = tagsByResourceId.get(row.resourceId) ?? []
    existing.push(row.tagName)
    tagsByResourceId.set(row.resourceId, existing)
  }

  return tagsByResourceId
}

async function attachTags(resources: ResourceCard[]): Promise<ResourceCard[]> {
  const tagsByResourceId = await listTagsForResourceIds(resources.map((r) => r.id))

  return resources.map((resource) => ({
    ...resource,
    tags: tagsByResourceId.get(resource.id) ?? [],
  }))
}

/**
 * Fire-and-forget: resolve favicons for any hostnames that aren't yet cached.
 * Errors are swallowed so they never block the main save path.
 */
async function seedFaviconCacheForUrls(urls: string[]): Promise<void> {
  const hostnames = uniqueHostnames(urls)
  if (hostnames.length === 0) return

  const existing = await getFaviconUrlsByHostnames(hostnames)
  const uncached = hostnames.filter((h) => !existing.has(h))

  await Promise.allSettled(
    uncached.map(async (hostname) => {
      const faviconUrl = await resolveFaviconUrl(hostname)
      await upsertFaviconCache(hostname, faviconUrl)
    })
  )
}

async function attachFavicons(resources: ResourceCard[]): Promise<ResourceCard[]> {
  // Collect all unique hostnames across every link in every resource
  const allHostnames = new Set<string>()
  for (const resource of resources) {
    for (const link of resource.links) {
      const h = hostnameFromUrl(link.url)
      if (h) allHostnames.add(h)
    }
  }

  if (allHostnames.size === 0) return resources

  const faviconByHostname = await getFaviconUrlsByHostnames([...allHostnames])

  return resources.map((resource) => ({
    ...resource,
    links: resource.links.map((link) => {
      const hostname = hostnameFromUrl(link.url)
      const faviconUrl = hostname ? (faviconByHostname.get(hostname) ?? null) : null
      return { ...link, faviconUrl }
    }),
  }))
}

async function findResourceById(
  id: string,
  options: { includeDeleted: boolean }
): Promise<ResourceCard | null> {
  const db = getDb()

  const whereCondition = options.includeDeleted
    ? eq(resourceCards.id, id)
    : and(eq(resourceCards.id, id), isNull(resourceCards.deletedAt))

  const rows = await db
    .select({
      resourceId: resourceCards.id,
      resourceCategory: resourceCards.category,
      resourceDeletedAt: resourceCards.deletedAt,
      linkId: resourceLinks.id,
      linkUrl: resourceLinks.url,
      linkLabel: resourceLinks.label,
      linkNote: resourceLinks.note,
    })
    .from(resourceCards)
    .leftJoin(resourceLinks, eq(resourceCards.id, resourceLinks.resourceId))
    .where(whereCondition)
    .orderBy(asc(resourceLinks.position))

  const resources = await attachFavicons(await attachTags(mapRowsToResources(rows)))
  return resources[0] ?? null
}

async function syncCategoriesFromResources() {
  const db = getDb()

  await db.execute(sql`
    INSERT INTO resource_categories (name)
    SELECT DISTINCT trim(category)
    FROM resource_cards
    WHERE trim(category) <> ''
    ON CONFLICT DO NOTHING
  `)
}

async function findCategoryByName(name: string): Promise<ResourceCategory | null> {
  const db = getDb()

  const rows = await db
    .select({
      id: resourceCategories.id,
      name: resourceCategories.name,
      symbol: resourceCategories.symbol,
      createdAt: resourceCategories.createdAt,
      updatedAt: resourceCategories.updatedAt,
    })
    .from(resourceCategories)
    .where(sql`lower(${resourceCategories.name}) = ${name.toLowerCase()}`)
    .limit(1)

  if (rows.length === 0) {
    return null
  }

  return normalizeCategoryRow(rows[0] as ResourceCategoryRow)
}

async function ensureCategoryByName(
  name: string,
  symbol?: string | null
): Promise<ResourceCategory> {
  const db = getDb()
  const normalizedName = normalizeCategoryName(name)
  const normalizedSymbol = normalizeCategorySymbol(symbol)

  if (!normalizedName) {
    throw new Error("Category name is required.")
  }

  try {
    const inserted = await db
      .insert(resourceCategories)
      .values({
        name: normalizedName,
        symbol: normalizedSymbol,
      })
      .returning({
        id: resourceCategories.id,
        name: resourceCategories.name,
        symbol: resourceCategories.symbol,
        createdAt: resourceCategories.createdAt,
        updatedAt: resourceCategories.updatedAt,
      })

    const created = inserted[0]
    if (created) {
      return normalizeCategoryRow(created as ResourceCategoryRow)
    }
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error
    }
  }

  const existing = await findCategoryByName(normalizedName)
  if (!existing) {
    throw new Error("Failed to resolve category.")
  }

  return existing
}

async function ensureTagsByName(tagNames: string[]): Promise<string[]> {
  const db = getDb()
  const ids: string[] = []
  const seen = new Set<string>()

  for (const rawName of tagNames) {
    const normalizedName = normalizeTagName(rawName)
    if (!normalizedName) {
      continue
    }

    const key = normalizedName.toLowerCase()
    if (seen.has(key)) {
      continue
    }
    seen.add(key)

    try {
      const inserted = await db
        .insert(resourceTags)
        .values({
          name: normalizedName,
        })
        .returning({
          id: resourceTags.id,
          name: resourceTags.name,
        })

      const created = inserted[0]
      if (created) {
        ids.push(created.id)
        continue
      }
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error
      }
    }

    const existingRows = await db
      .select({
        id: resourceTags.id,
      })
      .from(resourceTags)
      .where(sql`lower(${resourceTags.name}) = ${normalizedName.toLowerCase()}`)
      .limit(1)

    const existing = existingRows[0]
    if (existing) {
      ids.push(existing.id)
    }
  }

  return ids
}

async function setTagsForResource(resourceId: string, tags: string[]) {
  const db = getDb()

  await db.delete(resourceCardTags).where(eq(resourceCardTags.resourceId, resourceId))

  const tagIds = await ensureTagsByName(tags)
  if (tagIds.length === 0) {
    return
  }

  await db.insert(resourceCardTags).values(
    tagIds.map((tagId) => ({
      resourceId,
      tagId,
    }))
  )
}

export async function listResourceCategories(): Promise<ResourceCategory[]> {
  await ensureSchema()
  const db = getDb()

  await ensureCategoryByName(DEFAULT_RESOURCE_CATEGORY_NAME)
  await syncCategoriesFromResources()

  const rows = await db
    .select({
      id: resourceCategories.id,
      name: resourceCategories.name,
      symbol: resourceCategories.symbol,
      createdAt: resourceCategories.createdAt,
      updatedAt: resourceCategories.updatedAt,
    })
    .from(resourceCategories)
    .orderBy(sql`lower(${resourceCategories.name}) asc`)

  return (rows as ResourceCategoryRow[]).map(normalizeCategoryRow)
}

export async function createResourceCategory(
  name: string,
  symbol?: string | null
): Promise<ResourceCategory> {
  await ensureSchema()
  const db = getDb()
  const normalizedName = normalizeCategoryName(name)
  const normalizedSymbol = normalizeCategorySymbol(symbol)

  if (!normalizedName) {
    throw new Error("Category name is required.")
  }

  try {
    const rows = await db
      .insert(resourceCategories)
      .values({
        name: normalizedName,
        symbol: normalizedSymbol,
      })
      .returning({
        id: resourceCategories.id,
        name: resourceCategories.name,
        symbol: resourceCategories.symbol,
        createdAt: resourceCategories.createdAt,
        updatedAt: resourceCategories.updatedAt,
      })

    const created = rows[0]
    if (!created) {
      throw new Error("Failed to create category.")
    }

    return normalizeCategoryRow(created as ResourceCategoryRow)
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ResourceCategoryAlreadyExistsError(normalizedName)
    }

    throw error
  }
}

export async function updateResourceCategorySymbol(
  categoryId: string,
  symbol: string | null
): Promise<ResourceCategory> {
  await ensureSchema()
  const db = getDb()
  const normalizedSymbol = normalizeCategorySymbol(symbol)

  const rows = await db
    .update(resourceCategories)
    .set({
      symbol: normalizedSymbol,
      updatedAt: sql`NOW()`,
    })
    .where(eq(resourceCategories.id, categoryId))
    .returning({
      id: resourceCategories.id,
      name: resourceCategories.name,
      symbol: resourceCategories.symbol,
      createdAt: resourceCategories.createdAt,
      updatedAt: resourceCategories.updatedAt,
    })

  const updated = rows[0]
  if (!updated) {
    throw new ResourceCategoryNotFoundError(categoryId)
  }

  return normalizeCategoryRow(updated as ResourceCategoryRow)
}

export async function deleteResourceCategory(
  categoryId: string
): Promise<{
  deletedCategory: ResourceCategory
  reassignedCategory: ResourceCategory
  reassignedResources: number
}> {
  await ensureSchema()
  const db = getDb()

  const rows = await db
    .select({
      id: resourceCategories.id,
      name: resourceCategories.name,
      symbol: resourceCategories.symbol,
      createdAt: resourceCategories.createdAt,
      updatedAt: resourceCategories.updatedAt,
    })
    .from(resourceCategories)
    .where(eq(resourceCategories.id, categoryId))
    .limit(1)

  const existing = rows[0]
  if (!existing) {
    throw new ResourceCategoryNotFoundError(categoryId)
  }

  const deletedCategory = normalizeCategoryRow(existing as ResourceCategoryRow)
  const normalizedDeletedName = deletedCategory.name.toLowerCase()

  const fallbackName =
    normalizedDeletedName === DEFAULT_RESOURCE_CATEGORY_NAME.toLowerCase()
      ? FALLBACK_RESOURCE_CATEGORY_NAME
      : DEFAULT_RESOURCE_CATEGORY_NAME
  const reassignedCategory = await ensureCategoryByName(fallbackName)

  const reassigned = await db
    .update(resourceCards)
    .set({
      category: reassignedCategory.name,
      updatedAt: sql`NOW()`,
    })
    .where(sql`lower(${resourceCards.category}) = ${normalizedDeletedName}`)
    .returning({ id: resourceCards.id })

  await db.delete(resourceCategories).where(eq(resourceCategories.id, categoryId))

  return {
    deletedCategory,
    reassignedCategory,
    reassignedResources: reassigned.length,
  }
}

export async function hasAnyResources(): Promise<boolean> {
  await ensureSchema()
  const db = getDb()

  const rows = await db.select({ id: resourceCards.id }).from(resourceCards).limit(1)

  return rows.length > 0
}

export async function listResources(): Promise<ResourceCard[]> {
  await ensureSchema()
  const db = getDb()

  const rows = await db
    .select({
      resourceId: resourceCards.id,
      resourceCategory: resourceCards.category,
      resourceDeletedAt: resourceCards.deletedAt,
      linkId: resourceLinks.id,
      linkUrl: resourceLinks.url,
      linkLabel: resourceLinks.label,
      linkNote: resourceLinks.note,
    })
    .from(resourceCards)
    .leftJoin(resourceLinks, eq(resourceCards.id, resourceLinks.resourceId))
    .where(isNull(resourceCards.deletedAt))
    .orderBy(desc(resourceCards.createdAt), asc(resourceLinks.position))

  return attachFavicons(await attachTags(mapRowsToResources(rows)))
}

export async function listResourcesIncludingDeleted(): Promise<ResourceCard[]> {
  await ensureSchema()
  const db = getDb()

  const rows = await db
    .select({
      resourceId: resourceCards.id,
      resourceCategory: resourceCards.category,
      resourceDeletedAt: resourceCards.deletedAt,
      linkId: resourceLinks.id,
      linkUrl: resourceLinks.url,
      linkLabel: resourceLinks.label,
      linkNote: resourceLinks.note,
    })
    .from(resourceCards)
    .leftJoin(resourceLinks, eq(resourceCards.id, resourceLinks.resourceId))
    .orderBy(desc(resourceCards.createdAt), asc(resourceLinks.position))

  return attachFavicons(await attachTags(mapRowsToResources(rows)))
}

export async function listResourceAuditLogs(
  limit = 200
): Promise<ResourceAuditLogEntry[]> {
  await ensureSchema()
  const db = getDb()
  const boundedLimit = Math.max(1, Math.min(limit, 500))

  const rows = await db
    .select({
      logId: resourceAuditLogs.id,
      logResourceId: resourceAuditLogs.resourceId,
      logAction: resourceAuditLogs.action,
      logActorUserId: resourceAuditLogs.actorUserId,
      logActorIdentifier: resourceAuditLogs.actorIdentifier,
      logCreatedAt: resourceAuditLogs.createdAt,
      resourceCategory: resourceCards.category,
    })
    .from(resourceAuditLogs)
    .innerJoin(resourceCards, eq(resourceAuditLogs.resourceId, resourceCards.id))
    .orderBy(desc(resourceAuditLogs.createdAt))
    .limit(boundedLimit)

  return (rows as ResourceAuditJoinRow[]).map((row) => ({
    id: row.logId,
    resourceId: row.logResourceId,
    resourceCategory: row.resourceCategory,
    action: normalizeAuditAction(row.logAction),
    actorUserId: row.logActorUserId,
    actorIdentifier: row.logActorIdentifier,
    createdAt: normalizeTimestamp(row.logCreatedAt) ?? new Date(0).toISOString(),
  }))
}

export async function createResource(input: ResourceInput): Promise<ResourceCard> {
  await ensureSchema()
  const db = getDb()
  const categoryName = normalizeCategoryName(input.category)

  await ensureCategoryByName(categoryName)

  const insertedCards = await db
    .insert(resourceCards)
    .values({
      category: categoryName,
    })
    .returning({
      id: resourceCards.id,
    })

  const createdCard = insertedCards[0]
  if (!createdCard) {
    throw new Error("Failed to create resource card.")
  }

  if (input.links.length > 0) {
    await db.insert(resourceLinks).values(
      input.links.map((link, position) => ({
        resourceId: createdCard.id,
        url: link.url,
        label: link.label,
        note: link.note ?? null,
        position,
      }))
    )
  }

  await setTagsForResource(createdCard.id, input.tags)

  // Resolve and cache favicons for new links (non-blocking on failure)
  void seedFaviconCacheForUrls(input.links.map((l) => l.url))

  const resource = await findResourceById(createdCard.id, { includeDeleted: false })
  if (!resource) {
    throw new Error("Failed to read created resource card.")
  }

  return resource
}

export async function updateResource(
  id: string,
  input: ResourceInput
): Promise<ResourceCard> {
  await ensureSchema()
  const db = getDb()
  const categoryName = normalizeCategoryName(input.category)

  await ensureCategoryByName(categoryName)

  const updatedCards = await db
    .update(resourceCards)
    .set({
      category: categoryName,
      updatedAt: sql`NOW()`,
    })
    .where(and(eq(resourceCards.id, id), isNull(resourceCards.deletedAt)))
    .returning({
      id: resourceCards.id,
    })

  if (updatedCards.length === 0) {
    throw new ResourceNotFoundError(id)
  }

  await db.delete(resourceLinks).where(eq(resourceLinks.resourceId, id))

  if (input.links.length > 0) {
    await db.insert(resourceLinks).values(
      input.links.map((link, position) => ({
        resourceId: id,
        url: link.url,
        label: link.label,
        note: link.note ?? null,
        position,
      }))
    )
  }

  await setTagsForResource(id, input.tags)

  // Resolve and cache favicons for any newly added links (non-blocking on failure)
  void seedFaviconCacheForUrls(input.links.map((l) => l.url))

  const resource = await findResourceById(id, { includeDeleted: false })
  if (!resource) {
    throw new ResourceNotFoundError(id)
  }

  return resource
}

export async function deleteResource(
  id: string,
  actor?: ResourceAuditActor
): Promise<void> {
  await ensureSchema()
  const db = getDb()

  const rows = await db
    .update(resourceCards)
    .set({
      deletedAt: sql`NOW()`,
      updatedAt: sql`NOW()`,
    })
    .where(and(eq(resourceCards.id, id), isNull(resourceCards.deletedAt)))
    .returning({ id: resourceCards.id })

  const archived = rows[0]
  if (!archived) {
    throw new ResourceNotFoundError(id)
  }

  await appendAuditLog(archived.id, "archived", actor)
}

export async function restoreResource(
  id: string,
  actor?: ResourceAuditActor
): Promise<ResourceCard> {
  await ensureSchema()
  const db = getDb()

  const rows = await db
    .update(resourceCards)
    .set({
      deletedAt: null,
      updatedAt: sql`NOW()`,
    })
    .where(and(eq(resourceCards.id, id), isNotNull(resourceCards.deletedAt)))
    .returning({ id: resourceCards.id })

  const restored = rows[0]
  if (!restored) {
    throw new ResourceNotFoundError(id)
  }

  await appendAuditLog(restored.id, "restored", actor)

  const resource = await findResourceById(id, { includeDeleted: false })
  if (!resource) {
    throw new ResourceNotFoundError(id)
  }

  return resource
}
