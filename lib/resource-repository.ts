import "server-only"

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm"

import { ensureSchema, getDb } from "@/lib/db"
import {
  appUsers,
  resourceAuditLogs,
  resourceCardTags,
  resourceCards,
  resourceCategories,
  resourceLinks,
  resourceTags,
  resourceWorkspaces,
} from "@/lib/db-schema"
import {
  getFaviconUrlsByHostnames,
  listHostnamesMissingStoredFavicons,
  upsertFaviconCache,
} from "@/lib/favicon-repository"
import {
  hostnameFromUrl,
  resolveFavicon,
  uniqueHostnames,
} from "@/lib/favicon-service"
import type {
  ResourceAuditAction,
  ResourceAuditActor,
  ResourceAuditLogEntry,
  ResourceCard,
  ResourceCategory,
  ResourceInput,
  ResourceWorkspace,
} from "@/lib/resources"

const MAIN_RESOURCE_WORKSPACE_NAME = "Main Workspace"
const DEFAULT_RESOURCE_CATEGORY_NAME = "General"
const FALLBACK_RESOURCE_CATEGORY_NAME = "Uncategorized"
const WORKSPACE_OWNER_SENTINEL_UUID = "00000000-0000-0000-0000-000000000000"

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

export class ResourceWorkspaceNotFoundError extends Error {
  constructor(id: string) {
    super(`Workspace ${id} was not found.`)
    this.name = "ResourceWorkspaceNotFoundError"
  }
}

export class ResourceWorkspaceAlreadyExistsError extends Error {
  constructor(name: string) {
    super(`Workspace ${name} already exists.`)
    this.name = "ResourceWorkspaceAlreadyExistsError"
  }
}

interface ResourceWorkspaceRow {
  id: string
  name: string
  ownerUserId: string | null
  createdAt: Date | string
  updatedAt: Date | string
}

interface ResourceCategoryRow {
  id: string
  workspaceId: string
  name: string
  symbol: string | null
  ownerUserId: string | null
  createdAt: Date | string
  updatedAt: Date | string
}

interface ResourceCategoryWithWorkspaceOwnerRow extends ResourceCategoryRow {
  workspaceOwnerUserId: string | null
}

interface ResourceJoinRow {
  resourceId: string
  resourceWorkspaceId: string
  resourceCategory: string
  resourceOwnerUserId: string | null
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

function normalizeWorkspaceName(value: string): string {
  return value.replace(/\s+/g, " ").trim()
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

function normalizeWorkspaceRow(row: ResourceWorkspaceRow): ResourceWorkspace {
  return {
    id: row.id,
    name: normalizeWorkspaceName(row.name),
    ownerUserId: row.ownerUserId ?? null,
    createdAt: normalizeTimestamp(row.createdAt) ?? new Date(0).toISOString(),
    updatedAt: normalizeTimestamp(row.updatedAt) ?? new Date(0).toISOString(),
  }
}

function normalizeCategoryRow(row: ResourceCategoryRow): ResourceCategory {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: normalizeCategoryName(row.name),
    symbol: normalizeCategorySymbol(row.symbol),
    ownerUserId: row.ownerUserId ?? null,
    createdAt: normalizeTimestamp(row.createdAt) ?? new Date(0).toISOString(),
    updatedAt: normalizeTimestamp(row.updatedAt) ?? new Date(0).toISOString(),
  }
}

function normalizeActorUserId(userId?: string | null): string | null {
  return userId?.trim() || null
}

function isWorkspaceVisibleToUser(
  workspaceOwnerUserId: string | null,
  userId: string | null
): boolean {
  if (!workspaceOwnerUserId) {
    return true
  }

  if (!userId) {
    return false
  }

  return workspaceOwnerUserId === userId
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
        workspaceId: row.resourceWorkspaceId,
        category: row.resourceCategory,
        ownerUserId: row.resourceOwnerUserId,
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
 * Fire-and-forget: resolve favicons for any hostnames that do not yet have
 * persisted image payloads in the cache.
 * Errors are swallowed so they never block the main save path.
 */
async function seedFaviconCacheForUrls(urls: string[]): Promise<void> {
  const hostnames = uniqueHostnames(urls)
  if (hostnames.length === 0) return

  const missingImagePayloads = await listHostnamesMissingStoredFavicons(hostnames)

  await Promise.allSettled(
    missingImagePayloads.map(async (hostname) => {
      const favicon = await resolveFavicon(hostname)
      await upsertFaviconCache(hostname, favicon)
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
      resourceWorkspaceId: resourceCards.workspaceId,
      resourceCategory: resourceCards.category,
      resourceOwnerUserId: resourceCards.ownerUserId,
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

async function ensureMainWorkspace(): Promise<ResourceWorkspace> {
  const db = getDb()

  await db.execute(sql`
    INSERT INTO resource_workspaces (name, owner_user_id)
    VALUES (${MAIN_RESOURCE_WORKSPACE_NAME}, NULL)
    ON CONFLICT (
      (coalesce(owner_user_id, ${WORKSPACE_OWNER_SENTINEL_UUID}::uuid)),
      (lower(name))
    ) DO NOTHING
  `)

  const rows = await db
    .select({
      id: resourceWorkspaces.id,
      name: resourceWorkspaces.name,
      ownerUserId: resourceWorkspaces.ownerUserId,
      createdAt: resourceWorkspaces.createdAt,
      updatedAt: resourceWorkspaces.updatedAt,
    })
    .from(resourceWorkspaces)
    .where(
      and(
        isNull(resourceWorkspaces.ownerUserId),
        sql`lower(${resourceWorkspaces.name}) = ${MAIN_RESOURCE_WORKSPACE_NAME.toLowerCase()}`
      )
    )
    .orderBy(asc(resourceWorkspaces.createdAt))
    .limit(1)

  const workspace = rows[0]
  if (!workspace) {
    throw new Error("Failed to initialize main workspace.")
  }

  return normalizeWorkspaceRow(workspace as ResourceWorkspaceRow)
}

async function findWorkspaceById(id: string): Promise<ResourceWorkspace | null> {
  const db = getDb()

  const rows = await db
    .select({
      id: resourceWorkspaces.id,
      name: resourceWorkspaces.name,
      ownerUserId: resourceWorkspaces.ownerUserId,
      createdAt: resourceWorkspaces.createdAt,
      updatedAt: resourceWorkspaces.updatedAt,
    })
    .from(resourceWorkspaces)
    .where(eq(resourceWorkspaces.id, id))
    .limit(1)

  const row = rows[0]
  if (!row) {
    return null
  }

  return normalizeWorkspaceRow(row as ResourceWorkspaceRow)
}

async function listVisibleWorkspaceIds(userId?: string | null): Promise<string[]> {
  const db = getDb()
  const normalizedUserId = normalizeActorUserId(userId)

  await ensureMainWorkspace()

  const condition = normalizedUserId
    ? or(
        isNull(resourceWorkspaces.ownerUserId),
        eq(resourceWorkspaces.ownerUserId, normalizedUserId)
      )
    : isNull(resourceWorkspaces.ownerUserId)

  const rows = await db
    .select({ id: resourceWorkspaces.id })
    .from(resourceWorkspaces)
    .where(condition)

  return rows.map((row) => row.id)
}

async function requireVisibleWorkspace(
  workspaceId: string,
  userId?: string | null
): Promise<ResourceWorkspace> {
  const normalizedWorkspaceId = workspaceId.trim()
  const normalizedUserId = normalizeActorUserId(userId)

  const workspace = await findWorkspaceById(normalizedWorkspaceId)
  if (!workspace) {
    throw new ResourceWorkspaceNotFoundError(normalizedWorkspaceId)
  }

  if (!isWorkspaceVisibleToUser(workspace.ownerUserId ?? null, normalizedUserId)) {
    throw new ResourceWorkspaceNotFoundError(normalizedWorkspaceId)
  }

  return workspace
}

async function resolveWorkspaceForInput(
  workspaceId: string | undefined,
  userId?: string | null
): Promise<ResourceWorkspace> {
  if (workspaceId?.trim()) {
    return requireVisibleWorkspace(workspaceId, userId)
  }

  return ensureMainWorkspace()
}

async function syncCategoriesFromResources() {
  const db = getDb()

  await db.execute(sql`
    INSERT INTO resource_categories (name, workspace_id, owner_user_id)
    SELECT
      source.normalized_name,
      source.workspace_id,
      source.owner_user_id
    FROM (
      SELECT DISTINCT ON (cards.workspace_id, lower(trim(cards.category)))
        trim(cards.category) AS normalized_name,
        cards.workspace_id,
        cards.owner_user_id
      FROM resource_cards AS cards
      WHERE trim(cards.category) <> ''
      ORDER BY
        cards.workspace_id,
        lower(trim(cards.category)),
        cards.updated_at DESC,
        cards.created_at DESC
    ) AS source
    ON CONFLICT (workspace_id, lower(name)) DO NOTHING
  `)
}

async function findCategoryByNameInWorkspace(
  name: string,
  workspaceId: string
): Promise<ResourceCategory | null> {
  const db = getDb()

  const rows = await db
    .select({
      id: resourceCategories.id,
      workspaceId: resourceCategories.workspaceId,
      name: resourceCategories.name,
      symbol: resourceCategories.symbol,
      ownerUserId: resourceCategories.ownerUserId,
      createdAt: resourceCategories.createdAt,
      updatedAt: resourceCategories.updatedAt,
    })
    .from(resourceCategories)
    .where(
      and(
        eq(resourceCategories.workspaceId, workspaceId),
        sql`lower(${resourceCategories.name}) = ${name.toLowerCase()}`
      )
    )
    .limit(1)

  if (rows.length === 0) {
    return null
  }

  return normalizeCategoryRow(rows[0] as ResourceCategoryRow)
}

async function ensureCategoryByName(
  name: string,
  workspaceId: string,
  symbol?: string | null,
  ownerUserId?: string | null
): Promise<ResourceCategory> {
  const db = getDb()
  const normalizedName = normalizeCategoryName(name)
  const normalizedSymbol = normalizeCategorySymbol(symbol)
  const normalizedOwnerUserId = ownerUserId?.trim() || null

  if (!normalizedName) {
    throw new Error("Category name is required.")
  }

  try {
    const inserted = await db
      .insert(resourceCategories)
      .values({
        workspaceId,
        name: normalizedName,
        symbol: normalizedSymbol,
        ownerUserId: normalizedOwnerUserId,
      })
      .returning({
        id: resourceCategories.id,
        workspaceId: resourceCategories.workspaceId,
        name: resourceCategories.name,
        symbol: resourceCategories.symbol,
        ownerUserId: resourceCategories.ownerUserId,
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

  const existing = await findCategoryByNameInWorkspace(normalizedName, workspaceId)
  if (!existing) {
    throw new Error("Failed to resolve category.")
  }

  if (!existing.ownerUserId && normalizedOwnerUserId) {
    const rows = await db
      .update(resourceCategories)
      .set({
        ownerUserId: normalizedOwnerUserId,
        updatedAt: sql`NOW()`,
      })
      .where(eq(resourceCategories.id, existing.id))
      .returning({
        id: resourceCategories.id,
        workspaceId: resourceCategories.workspaceId,
        name: resourceCategories.name,
        symbol: resourceCategories.symbol,
        ownerUserId: resourceCategories.ownerUserId,
        createdAt: resourceCategories.createdAt,
        updatedAt: resourceCategories.updatedAt,
      })

    const updated = rows[0]
    if (updated) {
      await db
        .update(resourceCards)
        .set({
          ownerUserId: normalizedOwnerUserId,
          updatedAt: sql`NOW()`,
        })
        .where(
          and(
            eq(resourceCards.workspaceId, workspaceId),
            sql`lower(${resourceCards.category}) = ${normalizedName.toLowerCase()}`
          )
        )

      return normalizeCategoryRow(updated as ResourceCategoryRow)
    }
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

async function findCategoryWithWorkspaceOwnerById(
  categoryId: string
): Promise<ResourceCategoryWithWorkspaceOwnerRow | null> {
  const db = getDb()

  const rows = await db
    .select({
      id: resourceCategories.id,
      workspaceId: resourceCategories.workspaceId,
      name: resourceCategories.name,
      symbol: resourceCategories.symbol,
      ownerUserId: resourceCategories.ownerUserId,
      createdAt: resourceCategories.createdAt,
      updatedAt: resourceCategories.updatedAt,
      workspaceOwnerUserId: resourceWorkspaces.ownerUserId,
    })
    .from(resourceCategories)
    .innerJoin(resourceWorkspaces, eq(resourceCategories.workspaceId, resourceWorkspaces.id))
    .where(eq(resourceCategories.id, categoryId))
    .limit(1)

  return (rows[0] as ResourceCategoryWithWorkspaceOwnerRow | undefined) ?? null
}

async function ensureCategoryVisibleToActor(
  categoryId: string,
  actorUserId?: string | null
): Promise<ResourceCategoryWithWorkspaceOwnerRow> {
  const normalizedActorUserId = normalizeActorUserId(actorUserId)
  const row = await findCategoryWithWorkspaceOwnerById(categoryId)

  if (!row) {
    throw new ResourceCategoryNotFoundError(categoryId)
  }

  if (
    !isWorkspaceVisibleToUser(
      row.workspaceOwnerUserId ?? null,
      normalizedActorUserId
    )
  ) {
    throw new ResourceCategoryNotFoundError(categoryId)
  }

  return row
}

export async function listResourceWorkspaces(options?: {
  userId?: string | null
}): Promise<ResourceWorkspace[]> {
  await ensureSchema()
  const db = getDb()
  const normalizedUserId = normalizeActorUserId(options?.userId)

  await ensureMainWorkspace()

  const whereCondition = normalizedUserId
    ? or(
        isNull(resourceWorkspaces.ownerUserId),
        eq(resourceWorkspaces.ownerUserId, normalizedUserId)
      )
    : isNull(resourceWorkspaces.ownerUserId)

  const rows = await db
    .select({
      id: resourceWorkspaces.id,
      name: resourceWorkspaces.name,
      ownerUserId: resourceWorkspaces.ownerUserId,
      createdAt: resourceWorkspaces.createdAt,
      updatedAt: resourceWorkspaces.updatedAt,
    })
    .from(resourceWorkspaces)
    .where(whereCondition)
    .orderBy(
      sql`${resourceWorkspaces.ownerUserId} IS NOT NULL`,
      sql`lower(${resourceWorkspaces.name}) asc`
    )

  return (rows as ResourceWorkspaceRow[]).map(normalizeWorkspaceRow)
}

export async function createResourceWorkspace(
  name: string,
  ownerUserId: string
): Promise<ResourceWorkspace> {
  await ensureSchema()
  const db = getDb()

  const normalizedName = normalizeWorkspaceName(name)
  const normalizedOwnerUserId = ownerUserId.trim()

  if (!normalizedOwnerUserId) {
    throw new Error("Workspace owner is required.")
  }

  if (!normalizedName) {
    throw new Error("Workspace name is required.")
  }

  try {
    const rows = await db
      .insert(resourceWorkspaces)
      .values({
        name: normalizedName,
        ownerUserId: normalizedOwnerUserId,
      })
      .returning({
        id: resourceWorkspaces.id,
        name: resourceWorkspaces.name,
        ownerUserId: resourceWorkspaces.ownerUserId,
        createdAt: resourceWorkspaces.createdAt,
        updatedAt: resourceWorkspaces.updatedAt,
      })

    const created = rows[0]
    if (!created) {
      throw new Error("Failed to create workspace.")
    }

    return normalizeWorkspaceRow(created as ResourceWorkspaceRow)
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ResourceWorkspaceAlreadyExistsError(normalizedName)
    }

    throw error
  }
}

export async function listResourceCategories(options?: {
  userId?: string | null
  workspaceId?: string | null
}): Promise<ResourceCategory[]> {
  await ensureSchema()
  const db = getDb()
  const normalizedUserId = normalizeActorUserId(options?.userId)
  const normalizedWorkspaceId = options?.workspaceId?.trim() || null

  await ensureMainWorkspace()
  await syncCategoriesFromResources()

  const visibleWorkspaceIds = await listVisibleWorkspaceIds(normalizedUserId)
  if (visibleWorkspaceIds.length === 0) {
    return []
  }

  if (normalizedWorkspaceId && !visibleWorkspaceIds.includes(normalizedWorkspaceId)) {
    return []
  }

  const workspaceScopeCondition = normalizedWorkspaceId
    ? eq(resourceCategories.workspaceId, normalizedWorkspaceId)
    : visibleWorkspaceIds.length === 1
      ? eq(resourceCategories.workspaceId, visibleWorkspaceIds[0])
      : inArray(resourceCategories.workspaceId, visibleWorkspaceIds)

  const rows = await db
    .select({
      id: resourceCategories.id,
      workspaceId: resourceCategories.workspaceId,
      name: resourceCategories.name,
      symbol: resourceCategories.symbol,
      ownerUserId: resourceCategories.ownerUserId,
      createdAt: resourceCategories.createdAt,
      updatedAt: resourceCategories.updatedAt,
    })
    .from(resourceCategories)
    .where(workspaceScopeCondition)
    .orderBy(sql`lower(${resourceCategories.name}) asc`)

  return (rows as ResourceCategoryRow[]).map(normalizeCategoryRow)
}

export async function createResourceCategory(
  name: string,
  symbol?: string | null,
  options?: { workspaceId?: string; ownerUserId?: string | null }
): Promise<ResourceCategory> {
  await ensureSchema()
  const db = getDb()

  const normalizedName = normalizeCategoryName(name)
  const normalizedSymbol = normalizeCategorySymbol(symbol)
  const normalizedOwnerUserId = normalizeActorUserId(options?.ownerUserId)

  if (!normalizedName) {
    throw new Error("Category name is required.")
  }

  const workspace = await resolveWorkspaceForInput(
    options?.workspaceId,
    normalizedOwnerUserId
  )

  try {
    const rows = await db
      .insert(resourceCategories)
      .values({
        workspaceId: workspace.id,
        name: normalizedName,
        symbol: normalizedSymbol,
        ownerUserId: normalizedOwnerUserId ?? workspace.ownerUserId ?? null,
      })
      .returning({
        id: resourceCategories.id,
        workspaceId: resourceCategories.workspaceId,
        name: resourceCategories.name,
        symbol: resourceCategories.symbol,
        ownerUserId: resourceCategories.ownerUserId,
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
  symbol: string | null,
  options?: { actorUserId?: string | null }
): Promise<ResourceCategory> {
  await ensureSchema()
  const db = getDb()
  const normalizedSymbol = normalizeCategorySymbol(symbol)

  await ensureCategoryVisibleToActor(categoryId, options?.actorUserId)

  const rows = await db
    .update(resourceCategories)
    .set({
      symbol: normalizedSymbol,
      updatedAt: sql`NOW()`,
    })
    .where(eq(resourceCategories.id, categoryId))
    .returning({
      id: resourceCategories.id,
      workspaceId: resourceCategories.workspaceId,
      name: resourceCategories.name,
      symbol: resourceCategories.symbol,
      ownerUserId: resourceCategories.ownerUserId,
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
  categoryId: string,
  options?: { actorUserId?: string | null }
): Promise<{
  deletedCategory: ResourceCategory
  reassignedCategory: ResourceCategory
  reassignedResources: number
}> {
  await ensureSchema()
  const db = getDb()

  const existing = await ensureCategoryVisibleToActor(categoryId, options?.actorUserId)
  const deletedCategory = normalizeCategoryRow(existing)
  const normalizedDeletedName = deletedCategory.name.toLowerCase()

  const fallbackName =
    normalizedDeletedName === DEFAULT_RESOURCE_CATEGORY_NAME.toLowerCase()
      ? FALLBACK_RESOURCE_CATEGORY_NAME
      : DEFAULT_RESOURCE_CATEGORY_NAME
  const reassignedCategory = await ensureCategoryByName(
    fallbackName,
    deletedCategory.workspaceId,
    undefined,
    options?.actorUserId ?? null
  )

  const reassigned = await db
    .update(resourceCards)
    .set({
      category: reassignedCategory.name,
      ownerUserId: reassignedCategory.ownerUserId ?? null,
      updatedAt: sql`NOW()`,
    })
    .where(
      and(
        eq(resourceCards.workspaceId, deletedCategory.workspaceId),
        sql`lower(${resourceCards.category}) = ${normalizedDeletedName}`
      )
    )
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

export async function listResources(options?: {
  userId?: string | null
}): Promise<ResourceCard[]> {
  await ensureSchema()
  const db = getDb()
  const visibleWorkspaceIds = await listVisibleWorkspaceIds(options?.userId)

  if (visibleWorkspaceIds.length === 0) {
    return []
  }

  const workspaceScopeCondition =
    visibleWorkspaceIds.length === 1
      ? eq(resourceCards.workspaceId, visibleWorkspaceIds[0])
      : inArray(resourceCards.workspaceId, visibleWorkspaceIds)

  const rows = await db
    .select({
      resourceId: resourceCards.id,
      resourceWorkspaceId: resourceCards.workspaceId,
      resourceCategory: resourceCards.category,
      resourceOwnerUserId: resourceCards.ownerUserId,
      resourceDeletedAt: resourceCards.deletedAt,
      linkId: resourceLinks.id,
      linkUrl: resourceLinks.url,
      linkLabel: resourceLinks.label,
      linkNote: resourceLinks.note,
    })
    .from(resourceCards)
    .leftJoin(resourceLinks, eq(resourceCards.id, resourceLinks.resourceId))
    .where(and(isNull(resourceCards.deletedAt), workspaceScopeCondition))
    .orderBy(desc(resourceCards.createdAt), asc(resourceLinks.position))

  return attachFavicons(await attachTags(mapRowsToResources(rows)))
}

export async function listResourcesIncludingDeleted(): Promise<ResourceCard[]> {
  await ensureSchema()
  const db = getDb()

  const rows = await db
    .select({
      resourceId: resourceCards.id,
      resourceWorkspaceId: resourceCards.workspaceId,
      resourceCategory: resourceCards.category,
      resourceOwnerUserId: resourceCards.ownerUserId,
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

export async function createResource(
  input: ResourceInput,
  options?: { ownerUserId?: string | null }
): Promise<ResourceCard> {
  await ensureSchema()
  const db = getDb()
  const normalizedOwnerUserId = normalizeActorUserId(options?.ownerUserId)

  const workspace = await resolveWorkspaceForInput(input.workspaceId, normalizedOwnerUserId)
  const categoryName = normalizeCategoryName(input.category)

  const category = await ensureCategoryByName(
    categoryName,
    workspace.id,
    undefined,
    normalizedOwnerUserId
  )

  const insertedCards = await db
    .insert(resourceCards)
    .values({
      workspaceId: workspace.id,
      category: categoryName,
      ownerUserId: category.ownerUserId ?? null,
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
  input: ResourceInput,
  options?: { ownerUserId?: string | null }
): Promise<ResourceCard> {
  await ensureSchema()
  const db = getDb()
  const normalizedOwnerUserId = normalizeActorUserId(options?.ownerUserId)

  const existingRows = await db
    .select({
      workspaceId: resourceCards.workspaceId,
    })
    .from(resourceCards)
    .where(and(eq(resourceCards.id, id), isNull(resourceCards.deletedAt)))
    .limit(1)

  const existing = existingRows[0]
  if (!existing) {
    throw new ResourceNotFoundError(id)
  }

  const workspace = await resolveWorkspaceForInput(
    input.workspaceId ?? existing.workspaceId,
    normalizedOwnerUserId
  )

  const categoryName = normalizeCategoryName(input.category)
  const category = await ensureCategoryByName(
    categoryName,
    workspace.id,
    undefined,
    normalizedOwnerUserId
  )

  const updatedCards = await db
    .update(resourceCards)
    .set({
      workspaceId: workspace.id,
      category: categoryName,
      ownerUserId: category.ownerUserId ?? null,
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

export async function getResourceOwnerById(
  id: string
): Promise<{ id: string; ownerUserId: string | null; deletedAt: string | null } | null> {
  await ensureSchema()
  const db = getDb()

  const rows = await db
    .select({
      id: resourceCards.id,
      ownerUserId: resourceCards.ownerUserId,
      deletedAt: resourceCards.deletedAt,
    })
    .from(resourceCards)
    .where(eq(resourceCards.id, id))
    .limit(1)

  const row = rows[0]
  if (!row) {
    return null
  }

  return {
    id: row.id,
    ownerUserId: row.ownerUserId ?? null,
    deletedAt: normalizeTimestamp(row.deletedAt),
  }
}

export async function updateResourceCategoryOwner(
  categoryId: string,
  ownerUserId: string | null
): Promise<{
  category: ResourceCategory
  updatedResources: number
}> {
  await ensureSchema()
  const db = getDb()
  const normalizedOwnerUserId = ownerUserId?.trim() || null

  if (normalizedOwnerUserId) {
    const ownerRows = await db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(eq(appUsers.id, normalizedOwnerUserId))
      .limit(1)

    if (ownerRows.length === 0) {
      throw new Error("Owner user does not exist.")
    }
  }

  const categoryRows = await db
    .update(resourceCategories)
    .set({
      ownerUserId: normalizedOwnerUserId,
      updatedAt: sql`NOW()`,
    })
    .where(eq(resourceCategories.id, categoryId))
    .returning({
      id: resourceCategories.id,
      workspaceId: resourceCategories.workspaceId,
      name: resourceCategories.name,
      symbol: resourceCategories.symbol,
      ownerUserId: resourceCategories.ownerUserId,
      createdAt: resourceCategories.createdAt,
      updatedAt: resourceCategories.updatedAt,
    })

  const updatedCategory = categoryRows[0]
  if (!updatedCategory) {
    throw new ResourceCategoryNotFoundError(categoryId)
  }

  const updatedResources = await db
    .update(resourceCards)
    .set({
      ownerUserId: normalizedOwnerUserId,
      updatedAt: sql`NOW()`,
    })
    .where(
      and(
        eq(resourceCards.workspaceId, updatedCategory.workspaceId),
        sql`lower(${resourceCards.category}) = ${updatedCategory.name.toLowerCase()}`
      )
    )
    .returning({ id: resourceCards.id })

  return {
    category: normalizeCategoryRow(updatedCategory as ResourceCategoryRow),
    updatedResources: updatedResources.length,
  }
}

export async function backfillResourceOwnershipToFirstAdmin(
  firstAdminUserId: string
): Promise<void> {
  await ensureSchema()
  const db = getDb()

  const normalizedFirstAdminUserId = firstAdminUserId.trim()
  if (!normalizedFirstAdminUserId) {
    return
  }

  await db.execute(sql`
    UPDATE resource_categories AS cat
    SET
      owner_user_id = ${normalizedFirstAdminUserId}::uuid,
      updated_at = NOW()
    WHERE
      cat.owner_user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM app_users AS u
        WHERE u.id = cat.owner_user_id
      )
  `)

  await db
    .update(resourceCategories)
    .set({
      ownerUserId: normalizedFirstAdminUserId,
      updatedAt: sql`NOW()`,
    })
    .where(isNull(resourceCategories.ownerUserId))

  await db.execute(sql`
    UPDATE resource_cards AS rc
    SET
      owner_user_id = ${normalizedFirstAdminUserId}::uuid,
      updated_at = NOW()
    WHERE
      rc.owner_user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM app_users AS u
        WHERE u.id = rc.owner_user_id
      )
  `)

  await db.execute(sql`
    UPDATE resource_cards AS rc
    SET
      owner_user_id = COALESCE(cat.owner_user_id, ${normalizedFirstAdminUserId}::uuid),
      updated_at = NOW()
    FROM resource_categories AS cat
    WHERE
      rc.workspace_id = cat.workspace_id
      AND lower(rc.category) = lower(cat.name)
      AND rc.owner_user_id IS DISTINCT FROM COALESCE(cat.owner_user_id, ${normalizedFirstAdminUserId}::uuid)
  `)

  await db
    .update(resourceCards)
    .set({
      ownerUserId: normalizedFirstAdminUserId,
      updatedAt: sql`NOW()`,
    })
    .where(isNull(resourceCards.ownerUserId))
}
