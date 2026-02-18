import "server-only";

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
} from "drizzle-orm";

import { ensureSchema, getDb } from "@/lib/db";
import {
  appUsers,
  resourceAuditLogs,
  resourceCardTags,
  resourceCards,
  resourceCategories,
  resourceLinks,
  resourceTags,
  resourceWorkspaces,
} from "@/lib/db-schema";
import {
  getFaviconUrlsByHostnames,
  listHostnamesMissingStoredFavicons,
  upsertFaviconCache,
} from "@/lib/favicon-repository";
import {
  fallbackFaviconUrlForHostname,
  hostnameFromUrl,
  resolveFavicon,
  uniqueHostnames,
} from "@/lib/favicon-service";
import type {
  ResourceAuditAction,
  ResourceAuditActor,
  ResourceAuditLogEntry,
  ResourceCard,
  ResourceCategory,
  ResourceInput,
  ResourceWorkspace,
} from "@/lib/resources";

const MAIN_RESOURCE_WORKSPACE_NAME = "Main Workspace";
const DEFAULT_RESOURCE_CATEGORY_NAME = "General";
const FALLBACK_RESOURCE_CATEGORY_NAME = "Uncategorized";
const WORKSPACE_OWNER_SENTINEL_UUID = "00000000-0000-0000-0000-000000000000";

export class ResourceNotFoundError extends Error {
  constructor(id: string) {
    super(`Resource ${id} was not found.`);
    this.name = "ResourceNotFoundError";
  }
}

export class ResourceCategoryNotFoundError extends Error {
  constructor(id: string) {
    super(`Category ${id} was not found.`);
    this.name = "ResourceCategoryNotFoundError";
  }
}

export class ResourceCategoryAlreadyExistsError extends Error {
  constructor(name: string) {
    super(`Category ${name} already exists.`);
    this.name = "ResourceCategoryAlreadyExistsError";
  }
}

export class ResourceWorkspaceNotFoundError extends Error {
  constructor(id: string) {
    super(`Workspace ${id} was not found.`);
    this.name = "ResourceWorkspaceNotFoundError";
  }
}

export class ResourceWorkspaceAlreadyExistsError extends Error {
  constructor(name: string) {
    super(`Workspace ${name} already exists.`);
    this.name = "ResourceWorkspaceAlreadyExistsError";
  }
}

export class ResourceWorkspaceLimitReachedError extends Error {
  constructor(limit: number) {
    super(`Workspace limit reached. You can create up to ${limit} workspace.`);
    this.name = "ResourceWorkspaceLimitReachedError";
  }
}

interface ResourceWorkspaceRow {
  id: string;
  name: string;
  ownerUserId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface ResourceCategoryRow {
  id: string;
  workspaceId: string;
  name: string;
  symbol: string | null;
  ownerUserId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface ResourceCategoryWithWorkspaceOwnerRow extends ResourceCategoryRow {
  workspaceOwnerUserId: string | null;
}

interface ResourceJoinRow {
  resourceId: string;
  resourceWorkspaceId: string;
  resourceCategory: string;
  resourceOwnerUserId: string | null;
  resourceDeletedAt: Date | string | null;
  resourceCreatedAt: Date | string | null;
  linkId: string | null;
  linkUrl: string | null;
  linkLabel: string | null;
  linkNote: string | null;
}

interface ResourceAuditJoinRow {
  logId: string;
  logResourceId: string;
  logAction: string;
  logActorUserId: string | null;
  logActorIdentifier: string;
  logCreatedAt: Date | string;
  resourceCategory: string;
}

interface ResourceTagJoinRow {
  resourceId: string;
  tagName: string;
}

function normalizeTimestamp(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

function normalizeWorkspaceName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeCategoryName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeCategoryNameLower(value: string): string {
  return normalizeCategoryName(value).toLowerCase();
}

function normalizeCategorySymbol(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 16);
}

function normalizeTimestampToMs(value: Date | string | null | undefined): number {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const parsed =
    value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function normalizeTagName(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 40);
}

function normalizeAuditAction(value: string): ResourceAuditAction {
  return value === "restored" ? "restored" : "archived";
}

function normalizeWorkspaceRow(row: ResourceWorkspaceRow): ResourceWorkspace {
  return {
    id: row.id,
    name: normalizeWorkspaceName(row.name),
    ownerUserId: row.ownerUserId ?? null,
    createdAt: normalizeTimestamp(row.createdAt) ?? new Date(0).toISOString(),
    updatedAt: normalizeTimestamp(row.updatedAt) ?? new Date(0).toISOString(),
  };
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
  };
}

function compareCategoryRowsForCanonical(
  left: ResourceCategoryRow,
  right: ResourceCategoryRow,
): number {
  const leftTs = normalizeTimestampToMs(left.createdAt);
  const rightTs = normalizeTimestampToMs(right.createdAt);
  if (leftTs !== rightTs) {
    return leftTs - rightTs;
  }

  return left.id.localeCompare(right.id);
}

function normalizedCategorySql(
  column: typeof resourceCategories.name | typeof resourceCards.category,
) {
  return sql`lower(regexp_replace(btrim(${column}), '[[:space:]]+', ' ', 'g'))`;
}

interface CategoryMergeOptions {
  includeCategoryIds?: string[];
  preferredSymbol?: string | null;
  symbolExplicit?: boolean;
  preferredOwnerUserId?: string | null;
  preferProvidedName?: boolean;
}

interface CategoryMergeOutcome {
  category: ResourceCategory;
  mergedCategoryIds: string[];
  updatedResources: number;
}

export interface MergeDuplicateCategoriesSummary {
  processedGroups: number;
  mergedCategories: number;
  updatedResources: number;
}

function isValidUuid(value: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

function normalizeAndValidateUuid(
  value: string | null | undefined,
  fieldName: string,
): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required.`);
  }
  if (!isValidUuid(trimmed)) {
    throw new Error(`${fieldName} must be a valid UUID.`);
  }
  return trimmed;
}

function normalizeActorUserId(userId?: string | null): string | null {
  const trimmed = userId?.trim() || null;
  if (trimmed && !isValidUuid(trimmed)) {
    return null;
  }
  return trimmed;
}

function isWorkspaceVisibleToUser(
  workspaceOwnerUserId: string | null,
  userId: string | null,
): boolean {
  if (!workspaceOwnerUserId) {
    return userId === null;
  }

  if (!userId) {
    return false;
  }

  return workspaceOwnerUserId === userId;
}

interface DatabaseError {
  code?: string;
  cause?: {
    code?: string;
  };
}

function isDatabaseError(error: unknown): error is DatabaseError {
  return typeof error === "object" && error !== null;
}

function readErrorCode(error: unknown): string | null {
  if (!isDatabaseError(error)) {
    return null;
  }

  if (typeof error.code === "string") {
    return error.code;
  }

  if (
    error.cause &&
    typeof error.cause === "object" &&
    "code" in error.cause &&
    typeof error.cause.code === "string"
  ) {
    return error.cause.code;
  }

  return null;
}

function isUniqueViolation(error: unknown): boolean {
  return readErrorCode(error) === "23505";
}

function normalizeAuditActor(actor?: ResourceAuditActor): {
  actorUserId: string | null;
  actorIdentifier: string;
} {
  const actorUserId = actor?.userId?.trim() || null;
  const normalizedIdentifier = actor?.identifier?.trim().toLowerCase();
  const fallbackIdentifier = actorUserId ?? "unknown";

  return {
    actorUserId,
    actorIdentifier: (normalizedIdentifier || fallbackIdentifier).slice(0, 320),
  };
}

async function appendAuditLog(
  resourceId: string,
  action: ResourceAuditAction,
  actor?: ResourceAuditActor,
) {
  const db = getDb();
  const { actorUserId, actorIdentifier } = normalizeAuditActor(actor);

  await db.insert(resourceAuditLogs).values({
    resourceId,
    action,
    actorUserId,
    actorIdentifier,
  });
}

function mapRowsToResources(rows: ResourceJoinRow[]): ResourceCard[] {
  const resourcesById = new Map<string, ResourceCard>();
  const orderedResources: ResourceCard[] = [];

  for (const row of rows) {
    let resource = resourcesById.get(row.resourceId);

    if (!resource) {
      resource = {
        id: row.resourceId,
        workspaceId: row.resourceWorkspaceId,
        category: row.resourceCategory,
        ownerUserId: row.resourceOwnerUserId,
        tags: [],
        deletedAt: normalizeTimestamp(row.resourceDeletedAt),
        createdAt: normalizeTimestamp(row.resourceCreatedAt),
        links: [],
      };
      resourcesById.set(row.resourceId, resource);
      orderedResources.push(resource);
    }

    if (row.linkId && row.linkUrl && row.linkLabel) {
      resource.links.push({
        id: row.linkId,
        url: row.linkUrl,
        label: row.linkLabel,
        note: row.linkNote,
      });
    }
  }

  return orderedResources;
}

async function listTagsForResourceIds(
  resourceIds: string[],
): Promise<Map<string, string[]>> {
  const tagsByResourceId = new Map<string, string[]>();
  if (resourceIds.length === 0) {
    return tagsByResourceId;
  }

  const db = getDb();
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
      asc(sql`lower(${resourceTags.name})`),
    );

  for (const row of rows as ResourceTagJoinRow[]) {
    const existing = tagsByResourceId.get(row.resourceId) ?? [];
    existing.push(row.tagName);
    tagsByResourceId.set(row.resourceId, existing);
  }

  return tagsByResourceId;
}

/**
 * Attach tags and favicons to a list of resources in a single parallel pass.
 * The two DB lookups (tags and favicon cache) are independent and fired
 * concurrently so they add only one RTT instead of two.
 */
async function attachTagsAndFavicons(
  resources: ResourceCard[],
): Promise<ResourceCard[]> {
  if (resources.length === 0) return resources;

  const allHostnames = new Set<string>();
  for (const resource of resources) {
    for (const link of resource.links) {
      const h = hostnameFromUrl(link.url);
      if (h) allHostnames.add(h);
    }
  }

  const [tagsByResourceId, faviconByHostname] = await Promise.all([
    listTagsForResourceIds(resources.map((r) => r.id)),
    allHostnames.size > 0
      ? getFaviconUrlsByHostnames([...allHostnames])
      : Promise.resolve(new Map<string, string | null>()),
  ]);

  return resources.map((resource) => ({
    ...resource,
    tags: tagsByResourceId.get(resource.id) ?? [],
    links: resource.links.map((link) => {
      const hostname = hostnameFromUrl(link.url);
      const faviconUrl = hostname
        ? (faviconByHostname.get(hostname) ??
          fallbackFaviconUrlForHostname(hostname))
        : null;
      return { ...link, faviconUrl };
    }),
  }));
}

/**
 * Fire-and-forget: resolve favicons for any hostnames that do not yet have
 * persisted image payloads in the cache.
 * Errors are swallowed so they never block the main save path.
 */
async function seedFaviconCacheForUrls(urls: string[]): Promise<void> {
  const hostnames = uniqueHostnames(urls);
  if (hostnames.length === 0) return;

  const missingImagePayloads =
    await listHostnamesMissingStoredFavicons(hostnames);

  await Promise.allSettled(
    missingImagePayloads.map(async (hostname) => {
      const favicon = await resolveFavicon(hostname);
      await upsertFaviconCache(hostname, favicon);
    }),
  );
}

async function findResourceById(
  id: string,
  options: { includeDeleted: boolean },
): Promise<ResourceCard | null> {
  const db = getDb();

  const whereCondition = options.includeDeleted
    ? eq(resourceCards.id, id)
    : and(eq(resourceCards.id, id), isNull(resourceCards.deletedAt));

  const rows = await db
    .select({
      resourceId: resourceCards.id,
      resourceWorkspaceId: resourceCards.workspaceId,
      resourceCategory: resourceCards.category,
      resourceOwnerUserId: resourceCards.ownerUserId,
      resourceDeletedAt: resourceCards.deletedAt,
      resourceCreatedAt: resourceCards.createdAt,
      linkId: resourceLinks.id,
      linkUrl: resourceLinks.url,
      linkLabel: resourceLinks.label,
      linkNote: resourceLinks.note,
    })
    .from(resourceCards)
    .leftJoin(resourceLinks, eq(resourceCards.id, resourceLinks.resourceId))
    .where(whereCondition)
    .orderBy(asc(resourceLinks.position));

  const resources = await attachTagsAndFavicons(mapRowsToResources(rows));
  return resources[0] ?? null;
}

// Memoised so the INSERT + SELECT only runs once per process/lambda instance.
// Concurrent callers share the same promise rather than racing to the DB.
let mainWorkspacePromise: Promise<ResourceWorkspace> | null = null;

async function ensureMainWorkspace(): Promise<ResourceWorkspace> {
  if (mainWorkspacePromise) return mainWorkspacePromise;

  mainWorkspacePromise = (async () => {
    const db = getDb();

    await db.execute(sql`
      INSERT INTO resource_workspaces (name, owner_user_id)
      VALUES (${MAIN_RESOURCE_WORKSPACE_NAME}, NULL)
      ON CONFLICT (
        (coalesce(owner_user_id, ${WORKSPACE_OWNER_SENTINEL_UUID}::uuid)),
        (lower(name))
      ) DO NOTHING
    `);

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
          sql`lower(${resourceWorkspaces.name}) = ${MAIN_RESOURCE_WORKSPACE_NAME.toLowerCase()}`,
        ),
      )
      .orderBy(asc(resourceWorkspaces.createdAt))
      .limit(1);

    const workspace = rows[0];
    if (!workspace) {
      mainWorkspacePromise = null; // allow retry on failure
      throw new Error("Failed to initialize main workspace.");
    }

    return normalizeWorkspaceRow(workspace as ResourceWorkspaceRow);
  })();

  return mainWorkspacePromise;
}

async function findWorkspaceById(
  id: string,
): Promise<ResourceWorkspace | null> {
  const db = getDb();

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
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }

  return normalizeWorkspaceRow(row as ResourceWorkspaceRow);
}

async function findFirstOwnedWorkspace(
  userId: string,
): Promise<ResourceWorkspace | null> {
  const db = getDb();

  const rows = await db
    .select({
      id: resourceWorkspaces.id,
      name: resourceWorkspaces.name,
      ownerUserId: resourceWorkspaces.ownerUserId,
      createdAt: resourceWorkspaces.createdAt,
      updatedAt: resourceWorkspaces.updatedAt,
    })
    .from(resourceWorkspaces)
    .where(eq(resourceWorkspaces.ownerUserId, userId))
    .orderBy(asc(resourceWorkspaces.createdAt))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }

  return normalizeWorkspaceRow(row as ResourceWorkspaceRow);
}

async function listVisibleWorkspaceIds(
  userId?: string | null,
  options?: { includeAllWorkspaces?: boolean },
): Promise<string[]> {
  const db = getDb();
  const normalizedUserId = normalizeActorUserId(userId);

  await ensureMainWorkspace();

  const condition = options?.includeAllWorkspaces
    ? undefined
    : normalizedUserId
      ? eq(resourceWorkspaces.ownerUserId, normalizedUserId)
      : isNull(resourceWorkspaces.ownerUserId);

  const baseQuery = db
    .select({ id: resourceWorkspaces.id })
    .from(resourceWorkspaces);
  const rows =
    condition === undefined ? await baseQuery : await baseQuery.where(condition);

  return rows.map((row) => row.id);
}

async function requireVisibleWorkspace(
  workspaceId: string,
  userId?: string | null,
  options?: { includeAllWorkspaces?: boolean },
): Promise<ResourceWorkspace> {
  const normalizedWorkspaceId = normalizeAndValidateUuid(
    workspaceId,
    "Workspace ID",
  );
  const normalizedUserId = normalizeActorUserId(userId);

  const workspace = await findWorkspaceById(normalizedWorkspaceId);
  if (!workspace) {
    throw new ResourceWorkspaceNotFoundError(normalizedWorkspaceId);
  }

  if (
    !options?.includeAllWorkspaces &&
    !isWorkspaceVisibleToUser(workspace.ownerUserId ?? null, normalizedUserId)
  ) {
    throw new ResourceWorkspaceNotFoundError(normalizedWorkspaceId);
  }

  return workspace;
}

async function resolveWorkspaceForInput(
  workspaceId: string | undefined,
  userId?: string | null,
  options?: { includeAllWorkspaces?: boolean },
): Promise<ResourceWorkspace> {
  if (workspaceId?.trim()) {
    return requireVisibleWorkspace(workspaceId, userId, options);
  }

  const normalizedUserId = normalizeActorUserId(userId);
  if (normalizedUserId) {
    const ownedWorkspace = await findFirstOwnedWorkspace(normalizedUserId);
    if (!ownedWorkspace) {
      throw new ResourceWorkspaceNotFoundError("personal-workspace");
    }

    return ownedWorkspace;
  }

  return ensureMainWorkspace();
}

async function findCategoryByNameInWorkspace(
  name: string,
  workspaceId: string,
): Promise<ResourceCategory | null> {
  const db = getDb();
  const normalizedName = normalizeCategoryName(name);
  if (!normalizedName) {
    return null;
  }

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
        sql`${normalizedCategorySql(resourceCategories.name)} = ${normalizeCategoryNameLower(normalizedName)}`,
      ),
    )
    .orderBy(asc(resourceCategories.createdAt), asc(resourceCategories.id))
    .limit(1);

  if (rows.length === 0) {
    return null;
  }

  return normalizeCategoryRow(rows[0] as ResourceCategoryRow);
}

function resolveMergedCategoryFields(
  categories: ResourceCategoryRow[],
  canonical: ResourceCategoryRow,
  normalizedName: string,
  options?: CategoryMergeOptions,
): { name: string; symbol: string | null; ownerUserId: string | null } {
  // Conflict strategy:
  // 1) Canonical row = oldest category in the normalized-name cluster
  //    unless a rename explicitly includes a source category ID (that row stays canonical).
  // 2) Name defaults to canonical normalized name; explicit rename can override it.
  // 3) Symbol prefers explicit update input, then canonical symbol, then first non-empty symbol in the cluster.
  // 4) Owner prefers canonical owner, then first non-null owner in the cluster, then optional preferred owner.
  const sorted = [...categories].sort(compareCategoryRowsForCanonical);
  const canonicalSymbol = normalizeCategorySymbol(canonical.symbol);
  const canonicalOwnerUserId = normalizeActorUserId(canonical.ownerUserId);
  const preferredSymbol = normalizeCategorySymbol(options?.preferredSymbol);
  const preferredOwnerUserId = normalizeActorUserId(options?.preferredOwnerUserId);
  const firstAvailableSymbol =
    sorted
      .map((category) => normalizeCategorySymbol(category.symbol))
      .find((value) => value !== null) ?? null;
  const firstAvailableOwnerUserId =
    sorted
      .map((category) => normalizeActorUserId(category.ownerUserId))
      .find((value) => value !== null) ?? null;

  return {
    name: options?.preferProvidedName
      ? normalizedName
      : normalizeCategoryName(canonical.name),
    symbol: options?.symbolExplicit
      ? preferredSymbol
      : canonicalSymbol ?? preferredSymbol ?? firstAvailableSymbol,
    ownerUserId:
      canonicalOwnerUserId ?? firstAvailableOwnerUserId ?? preferredOwnerUserId,
  };
}

async function mergeCategoriesInWorkspaceByNormalizedName(
  workspaceId: string,
  name: string,
  options?: CategoryMergeOptions,
): Promise<CategoryMergeOutcome | null> {
  const db = getDb();
  const normalizedName = normalizeCategoryName(name);
  const normalizedNameLower = normalizeCategoryNameLower(normalizedName);
  if (!normalizedName) {
    return null;
  }

  const includeCategoryIds = [
    ...new Set(
      (options?.includeCategoryIds ?? [])
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    ),
  ];
  const normalizedCondition =
    sql`${normalizedCategorySql(resourceCategories.name)} = ${normalizedNameLower}`;
  const whereCondition =
    includeCategoryIds.length > 0
      ? and(
          eq(resourceCategories.workspaceId, workspaceId),
          or(
            normalizedCondition,
            inArray(resourceCategories.id, includeCategoryIds),
          ),
        )
      : and(eq(resourceCategories.workspaceId, workspaceId), normalizedCondition);

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
    .where(whereCondition)
    .orderBy(asc(resourceCategories.createdAt), asc(resourceCategories.id));

  const matchingRows = (rows as ResourceCategoryRow[]).sort(
    compareCategoryRowsForCanonical,
  );
  if (matchingRows.length === 0) {
    return null;
  }

  const preferredCategoryIdSet = new Set(includeCategoryIds);
  const preferredCanonical =
    matchingRows.find((category) => preferredCategoryIdSet.has(category.id)) ??
    null;
  const canonical = preferredCanonical ?? matchingRows[0];
  const resolved = resolveMergedCategoryFields(
    matchingRows,
    canonical,
    normalizedName,
    options,
  );
  const normalizedCategoryKeys = [
    ...new Set([
      normalizedNameLower,
      ...matchingRows
        .map((category) => normalizeCategoryNameLower(category.name))
        .filter((key) => key.length > 0),
    ]),
  ];
  const resourceCategoryMatchCondition =
    normalizedCategoryKeys.length === 1
      ? sql`${normalizedCategorySql(resourceCards.category)} = ${normalizedCategoryKeys[0]}`
      : sql`${normalizedCategorySql(resourceCards.category)} IN (${sql.join(
          normalizedCategoryKeys.map((key) => sql`${key}`),
          sql`, `,
        )})`;

  let canonicalRow = canonical;
  const canonicalNeedsUpdate =
    normalizeCategoryName(canonical.name) !== resolved.name ||
    normalizeCategorySymbol(canonical.symbol) !== resolved.symbol ||
    normalizeActorUserId(canonical.ownerUserId) !== resolved.ownerUserId;

  if (canonicalNeedsUpdate) {
    const updatedRows = await db
      .update(resourceCategories)
      .set({
        name: resolved.name,
        symbol: resolved.symbol,
        ownerUserId: resolved.ownerUserId,
        updatedAt: sql`NOW()`,
      })
      .where(eq(resourceCategories.id, canonical.id))
      .returning({
        id: resourceCategories.id,
        workspaceId: resourceCategories.workspaceId,
        name: resourceCategories.name,
        symbol: resourceCategories.symbol,
        ownerUserId: resourceCategories.ownerUserId,
        createdAt: resourceCategories.createdAt,
        updatedAt: resourceCategories.updatedAt,
      });

    canonicalRow = (updatedRows[0] as ResourceCategoryRow | undefined) ?? canonical;
  }

  const resourceRows = await db
    .update(resourceCards)
    .set({
      category: resolved.name,
      ownerUserId: resolved.ownerUserId,
      updatedAt: sql`NOW()`,
    })
    .where(
      and(
        eq(resourceCards.workspaceId, workspaceId),
        resourceCategoryMatchCondition,
        or(
          sql`${resourceCards.category} IS DISTINCT FROM ${resolved.name}`,
          sql`${resourceCards.ownerUserId} IS DISTINCT FROM ${resolved.ownerUserId}`,
        ),
      ),
    )
    .returning({ id: resourceCards.id });

  const duplicateIds = matchingRows
    .filter((category) => category.id !== canonicalRow.id)
    .map((category) => category.id);
  if (duplicateIds.length > 0) {
    await db
      .delete(resourceCategories)
      .where(inArray(resourceCategories.id, duplicateIds));
  }

  return {
    category: normalizeCategoryRow(canonicalRow),
    mergedCategoryIds: duplicateIds,
    updatedResources: resourceRows.length,
  };
}

async function ensureCategoryByName(
  name: string,
  workspaceId: string,
  symbol?: string | null,
  ownerUserId?: string | null,
): Promise<ResourceCategory> {
  const db = getDb();
  const normalizedName = normalizeCategoryName(name);
  const normalizedSymbol = normalizeCategorySymbol(symbol);
  const normalizedOwnerUserId = normalizeActorUserId(ownerUserId);

  if (!normalizedName) {
    throw new Error("Category name is required.");
  }

  const mergedExisting = await mergeCategoriesInWorkspaceByNormalizedName(
    workspaceId,
    normalizedName,
    {
      preferredSymbol: normalizedSymbol,
      symbolExplicit: false,
      preferredOwnerUserId: normalizedOwnerUserId,
    },
  );
  if (mergedExisting) {
    return mergedExisting.category;
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
      });

    const created = inserted[0];
    if (created) {
      return normalizeCategoryRow(created as ResourceCategoryRow);
    }
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
  }

  const mergedAfterConflict = await mergeCategoriesInWorkspaceByNormalizedName(
    workspaceId,
    normalizedName,
    {
      preferredSymbol: normalizedSymbol,
      symbolExplicit: false,
      preferredOwnerUserId: normalizedOwnerUserId,
    },
  );
  if (mergedAfterConflict) {
    return mergedAfterConflict.category;
  }

  const existing = await findCategoryByNameInWorkspace(normalizedName, workspaceId);
  if (existing) {
    return existing;
  }

  throw new Error("Failed to resolve category.");
}

async function ensureTagsByName(tagNames: string[]): Promise<string[]> {
  const db = getDb();

  // Normalize and deduplicate tag names while preserving insertion order
  const normalizedTags: Array<{
    original: string;
    normalized: string;
    lowerKey: string;
  }> = [];
  const seen = new Set<string>();

  for (const rawName of tagNames) {
    const normalizedName = normalizeTagName(rawName);
    if (!normalizedName) {
      continue;
    }

    const lowerKey = normalizedName.toLowerCase();
    if (seen.has(lowerKey)) {
      continue;
    }

    seen.add(lowerKey);
    normalizedTags.push({
      original: rawName,
      normalized: normalizedName,
      lowerKey,
    });
  }

  if (normalizedTags.length === 0) {
    return [];
  }

  // Batch query for all existing tags
  const existingTags = await db
    .select({
      id: resourceTags.id,
      name: resourceTags.name,
    })
    .from(resourceTags)
    .where(
      sql`lower(${resourceTags.name}) IN (${sql.join(
        normalizedTags.map((t) => sql`${t.lowerKey}`),
        sql`, `,
      )})`,
    );

  const existingByLowerName = new Map<string, string>();
  for (const tag of existingTags) {
    existingByLowerName.set(tag.name.toLowerCase(), tag.id);
  }

  // Insert new tags that don't exist yet
  const tagsToInsert = normalizedTags.filter(
    (t) => !existingByLowerName.has(t.lowerKey),
  );

  if (tagsToInsert.length > 0) {
    try {
      const inserted = await db
        .insert(resourceTags)
        .values(tagsToInsert.map((t) => ({ name: t.normalized })))
        .returning({
          id: resourceTags.id,
          name: resourceTags.name,
        });

      for (const tag of inserted) {
        existingByLowerName.set(tag.name.toLowerCase(), tag.id);
      }
    } catch (error) {
      // Handle race condition where tags were created between our query and insert
      if (isUniqueViolation(error)) {
        const conflictingTags = await db
          .select({
            id: resourceTags.id,
            name: resourceTags.name,
          })
          .from(resourceTags)
          .where(
            sql`lower(${resourceTags.name}) IN (${sql.join(
              tagsToInsert.map((t) => sql`${t.lowerKey}`),
              sql`, `,
            )})`,
          );

        for (const tag of conflictingTags) {
          existingByLowerName.set(tag.name.toLowerCase(), tag.id);
        }
      } else {
        throw error;
      }
    }
  }

  // Return IDs in original order
  return normalizedTags
    .map((t) => existingByLowerName.get(t.lowerKey))
    .filter((id): id is string => id !== undefined);
}

async function setTagsForResource(resourceId: string, tags: string[]) {
  const db = getDb();

  await db
    .delete(resourceCardTags)
    .where(eq(resourceCardTags.resourceId, resourceId));

  const tagIds = await ensureTagsByName(tags);
  if (tagIds.length === 0) {
    return;
  }

  await db.insert(resourceCardTags).values(
    tagIds.map((tagId) => ({
      resourceId,
      tagId,
    })),
  );
}

async function findCategoryWithWorkspaceOwnerById(
  categoryId: string,
): Promise<ResourceCategoryWithWorkspaceOwnerRow | null> {
  const db = getDb();

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
    .innerJoin(
      resourceWorkspaces,
      eq(resourceCategories.workspaceId, resourceWorkspaces.id),
    )
    .where(eq(resourceCategories.id, categoryId))
    .limit(1);

  return (rows[0] as ResourceCategoryWithWorkspaceOwnerRow | undefined) ?? null;
}

async function ensureCategoryVisibleToActor(
  categoryId: string,
  actorUserId?: string | null,
  options?: { includeAllWorkspaces?: boolean },
): Promise<ResourceCategoryWithWorkspaceOwnerRow> {
  const normalizedActorUserId = normalizeActorUserId(actorUserId);
  const row = await findCategoryWithWorkspaceOwnerById(categoryId);

  if (!row) {
    throw new ResourceCategoryNotFoundError(categoryId);
  }

  if (
    !options?.includeAllWorkspaces &&
    !isWorkspaceVisibleToUser(
      row.workspaceOwnerUserId ?? null,
      normalizedActorUserId,
    )
  ) {
    throw new ResourceCategoryNotFoundError(categoryId);
  }

  return row;
}

export async function listResourceWorkspaces(options?: {
  userId?: string | null;
  includeAllWorkspaces?: boolean;
}): Promise<ResourceWorkspace[]> {
  await ensureSchema();
  const db = getDb();
  const normalizedUserId = normalizeActorUserId(options?.userId);

  await ensureMainWorkspace();

  const whereCondition = options?.includeAllWorkspaces
    ? undefined
    : normalizedUserId
      ? eq(resourceWorkspaces.ownerUserId, normalizedUserId)
      : isNull(resourceWorkspaces.ownerUserId);

  const baseQuery = db
    .select({
      id: resourceWorkspaces.id,
      name: resourceWorkspaces.name,
      ownerUserId: resourceWorkspaces.ownerUserId,
      createdAt: resourceWorkspaces.createdAt,
      updatedAt: resourceWorkspaces.updatedAt,
    })
    .from(resourceWorkspaces)
    .orderBy(
      sql`${resourceWorkspaces.ownerUserId} IS NOT NULL`,
      sql`lower(${resourceWorkspaces.name}) asc`,
    );
  const rows =
    whereCondition === undefined
      ? await baseQuery
      : await baseQuery.where(whereCondition);

  return (rows as ResourceWorkspaceRow[]).map(normalizeWorkspaceRow);
}

export async function createResourceWorkspace(
  name: string,
  ownerUserId: string,
): Promise<ResourceWorkspace> {
  await ensureSchema();
  const db = getDb();

  const normalizedName = normalizeWorkspaceName(name);
  const normalizedOwnerUserId = normalizeAndValidateUuid(
    ownerUserId,
    "Workspace owner ID",
  );

  if (!normalizedName) {
    throw new Error("Workspace name is required.");
  }

  // Validate that the owner user exists
  const ownerRows = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(eq(appUsers.id, normalizedOwnerUserId))
    .limit(1);

  if (ownerRows.length === 0) {
    throw new Error("Owner user does not exist.");
  }

  const existingWorkspaceRows = await db
    .select({ id: resourceWorkspaces.id })
    .from(resourceWorkspaces)
    .where(eq(resourceWorkspaces.ownerUserId, normalizedOwnerUserId))
    .limit(1);

  if (existingWorkspaceRows.length >= 1) {
    throw new ResourceWorkspaceLimitReachedError(1);
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
      });

    const created = rows[0];
    if (!created) {
      throw new Error("Failed to create workspace.");
    }

    return normalizeWorkspaceRow(created as ResourceWorkspaceRow);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ResourceWorkspaceAlreadyExistsError(normalizedName);
    }

    throw error;
  }
}

export async function renameResourceWorkspace(
  id: string,
  name: string,
  ownerUserId: string,
): Promise<ResourceWorkspace> {
  await ensureSchema();
  const db = getDb();

  const normalizedId = normalizeAndValidateUuid(id, "Workspace ID");
  const normalizedName = normalizeWorkspaceName(name);
  const normalizedOwnerUserId = normalizeAndValidateUuid(ownerUserId, "Owner user ID");

  if (!normalizedName) {
    throw new Error("Workspace name is required.");
  }

  try {
    const rows = await db
      .update(resourceWorkspaces)
      .set({ name: normalizedName, updatedAt: new Date() })
      .where(
        and(
          eq(resourceWorkspaces.id, normalizedId),
          eq(resourceWorkspaces.ownerUserId, normalizedOwnerUserId),
        ),
      )
      .returning({
        id: resourceWorkspaces.id,
        name: resourceWorkspaces.name,
        ownerUserId: resourceWorkspaces.ownerUserId,
        createdAt: resourceWorkspaces.createdAt,
        updatedAt: resourceWorkspaces.updatedAt,
      });

    const updated = rows[0];
    if (!updated) {
      throw new ResourceWorkspaceNotFoundError(normalizedId);
    }

    return normalizeWorkspaceRow(updated as ResourceWorkspaceRow);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ResourceWorkspaceAlreadyExistsError(normalizedName);
    }
    throw error;
  }
}

export async function deleteResourceWorkspace(
  id: string,
  ownerUserId: string,
): Promise<void> {
  await ensureSchema();
  const db = getDb();

  const normalizedId = normalizeAndValidateUuid(id, "Workspace ID");
  const normalizedOwnerUserId = normalizeAndValidateUuid(ownerUserId, "Owner user ID");

  const rows = await db
    .delete(resourceWorkspaces)
    .where(
      and(
        eq(resourceWorkspaces.id, normalizedId),
        eq(resourceWorkspaces.ownerUserId, normalizedOwnerUserId),
      ),
    )
    .returning({ id: resourceWorkspaces.id });

  if (rows.length === 0) {
    throw new ResourceWorkspaceNotFoundError(normalizedId);
  }
}

export async function listResourceCategories(options?: {
  userId?: string | null;
  workspaceId?: string | null;
  includeAllWorkspaces?: boolean;
}): Promise<ResourceCategory[]> {
  await ensureSchema();
  const db = getDb();
  const normalizedUserId = normalizeActorUserId(options?.userId);
  const normalizedWorkspaceId = options?.workspaceId?.trim() || null;

  const visibleWorkspaceIds = await listVisibleWorkspaceIds(normalizedUserId, {
    includeAllWorkspaces: options?.includeAllWorkspaces,
  });
  if (visibleWorkspaceIds.length === 0) {
    return [];
  }

  if (
    normalizedWorkspaceId &&
    !visibleWorkspaceIds.includes(normalizedWorkspaceId)
  ) {
    return [];
  }

  const workspaceScopeCondition = normalizedWorkspaceId
    ? eq(resourceCategories.workspaceId, normalizedWorkspaceId)
    : visibleWorkspaceIds.length === 1
      ? eq(resourceCategories.workspaceId, visibleWorkspaceIds[0])
      : inArray(resourceCategories.workspaceId, visibleWorkspaceIds);

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
    .orderBy(sql`lower(${resourceCategories.name}) asc`);

  return (rows as ResourceCategoryRow[]).map(normalizeCategoryRow);
}

export async function createResourceCategory(
  name: string,
  symbol?: string | null,
  options?: {
    workspaceId?: string;
    ownerUserId?: string | null;
    includeAllWorkspaces?: boolean;
  },
): Promise<ResourceCategory> {
  await ensureSchema();

  const normalizedName = normalizeCategoryName(name);
  const normalizedSymbol = normalizeCategorySymbol(symbol);
  const normalizedOwnerUserId = normalizeActorUserId(options?.ownerUserId);

  if (!normalizedName) {
    throw new Error("Category name is required.");
  }

  const workspace = await resolveWorkspaceForInput(
    options?.workspaceId,
    normalizedOwnerUserId,
    { includeAllWorkspaces: options?.includeAllWorkspaces },
  );

  return ensureCategoryByName(
    normalizedName,
    workspace.id,
    normalizedSymbol,
    normalizedOwnerUserId ?? workspace.ownerUserId ?? null,
  );
}

export async function updateResourceCategory(
  categoryId: string,
  input: { name?: string; symbol?: string | null },
  options?: { actorUserId?: string | null; includeAllWorkspaces?: boolean },
): Promise<ResourceCategory> {
  await ensureSchema();
  const db = getDb();

  const existing = await ensureCategoryVisibleToActor(
    categoryId,
    options?.actorUserId,
    { includeAllWorkspaces: options?.includeAllWorkspaces },
  );
  const normalizedExistingName = normalizeCategoryName(existing.name);
  const normalizedName =
    typeof input.name === "string"
      ? normalizeCategoryName(input.name)
      : normalizedExistingName;
  const normalizedSymbol =
    input.symbol === undefined
      ? normalizeCategorySymbol(existing.symbol)
      : normalizeCategorySymbol(input.symbol);

  if (!normalizedName) {
    throw new Error("Category name is required.");
  }

  if (input.name !== undefined) {
    const merged = await mergeCategoriesInWorkspaceByNormalizedName(
      existing.workspaceId,
      normalizedName,
      {
        includeCategoryIds: [existing.id],
        preferredSymbol: normalizedSymbol,
        symbolExplicit: input.symbol !== undefined,
        preferProvidedName: true,
      },
    );

    if (!merged) {
      throw new ResourceCategoryNotFoundError(categoryId);
    }

    return merged.category;
  }

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
    });

  const updated = rows[0] as ResourceCategoryRow | undefined;
  if (!updated) {
    throw new ResourceCategoryNotFoundError(categoryId);
  }

  return normalizeCategoryRow(updated);
}

export async function updateResourceCategorySymbol(
  categoryId: string,
  symbol: string | null,
  options?: { actorUserId?: string | null; includeAllWorkspaces?: boolean },
): Promise<ResourceCategory> {
  return updateResourceCategory(
    categoryId,
    { symbol },
    {
      actorUserId: options?.actorUserId,
      includeAllWorkspaces: options?.includeAllWorkspaces,
    },
  );
}

export async function deleteResourceCategory(
  categoryId: string,
  options?: { actorUserId?: string | null; includeAllWorkspaces?: boolean },
): Promise<{
  deletedCategory: ResourceCategory;
  reassignedCategory: ResourceCategory;
  reassignedResources: number;
}> {
  await ensureSchema();
  const db = getDb();

  const existing = await ensureCategoryVisibleToActor(
    categoryId,
    options?.actorUserId,
    { includeAllWorkspaces: options?.includeAllWorkspaces },
  );
  const deletedCategory = normalizeCategoryRow(existing);
  const normalizedDeletedName = normalizeCategoryNameLower(deletedCategory.name);

  const fallbackName =
    normalizedDeletedName === DEFAULT_RESOURCE_CATEGORY_NAME.toLowerCase()
      ? FALLBACK_RESOURCE_CATEGORY_NAME
      : DEFAULT_RESOURCE_CATEGORY_NAME;
  const reassignedCategory = await ensureCategoryByName(
    fallbackName,
    deletedCategory.workspaceId,
    undefined,
    options?.actorUserId ?? null,
  );

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
        sql`${normalizedCategorySql(resourceCards.category)} = ${normalizedDeletedName}`,
      ),
    )
    .returning({ id: resourceCards.id });

  await db
    .delete(resourceCategories)
    .where(eq(resourceCategories.id, categoryId));

  return {
    deletedCategory,
    reassignedCategory,
    reassignedResources: reassigned.length,
  };
}

export async function hasAnyResources(): Promise<boolean> {
  await ensureSchema();
  const db = getDb();

  const rows = await db
    .select({ id: resourceCards.id })
    .from(resourceCards)
    .limit(1);

  return rows.length > 0;
}

export async function listResources(options?: {
  userId?: string | null;
  includeAllWorkspaces?: boolean;
}): Promise<ResourceCard[]> {
  await ensureSchema();
  const db = getDb();
  const visibleWorkspaceIds = await listVisibleWorkspaceIds(options?.userId, {
    includeAllWorkspaces: options?.includeAllWorkspaces,
  });

  if (visibleWorkspaceIds.length === 0) {
    return [];
  }

  const workspaceScopeCondition =
    visibleWorkspaceIds.length === 1
      ? eq(resourceCards.workspaceId, visibleWorkspaceIds[0])
      : inArray(resourceCards.workspaceId, visibleWorkspaceIds);

  const rows = await db
    .select({
      resourceId: resourceCards.id,
      resourceWorkspaceId: resourceCards.workspaceId,
      resourceCategory: resourceCards.category,
      resourceOwnerUserId: resourceCards.ownerUserId,
      resourceDeletedAt: resourceCards.deletedAt,
      resourceCreatedAt: resourceCards.createdAt,
      linkId: resourceLinks.id,
      linkUrl: resourceLinks.url,
      linkLabel: resourceLinks.label,
      linkNote: resourceLinks.note,
    })
    .from(resourceCards)
    .leftJoin(resourceLinks, eq(resourceCards.id, resourceLinks.resourceId))
    .where(and(isNull(resourceCards.deletedAt), workspaceScopeCondition))
    .orderBy(desc(resourceCards.createdAt), asc(resourceLinks.position));

  return attachTagsAndFavicons(mapRowsToResources(rows));
}

export async function listResourcesIncludingDeleted(): Promise<ResourceCard[]> {
  await ensureSchema();
  const db = getDb();

  const rows = await db
    .select({
      resourceId: resourceCards.id,
      resourceWorkspaceId: resourceCards.workspaceId,
      resourceCategory: resourceCards.category,
      resourceOwnerUserId: resourceCards.ownerUserId,
      resourceDeletedAt: resourceCards.deletedAt,
      resourceCreatedAt: resourceCards.createdAt,
      linkId: resourceLinks.id,
      linkUrl: resourceLinks.url,
      linkLabel: resourceLinks.label,
      linkNote: resourceLinks.note,
    })
    .from(resourceCards)
    .leftJoin(resourceLinks, eq(resourceCards.id, resourceLinks.resourceId))
    .orderBy(desc(resourceCards.createdAt), asc(resourceLinks.position));

  return attachTagsAndFavicons(mapRowsToResources(rows));
}

export async function listResourceAuditLogs(
  limit = 200,
): Promise<ResourceAuditLogEntry[]> {
  await ensureSchema();
  const db = getDb();
  const boundedLimit = Math.max(1, Math.min(limit, 500));

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
    .innerJoin(
      resourceCards,
      eq(resourceAuditLogs.resourceId, resourceCards.id),
    )
    .orderBy(desc(resourceAuditLogs.createdAt))
    .limit(boundedLimit);

  return (rows as ResourceAuditJoinRow[]).map((row) => ({
    id: row.logId,
    resourceId: row.logResourceId,
    resourceCategory: row.resourceCategory,
    action: normalizeAuditAction(row.logAction),
    actorUserId: row.logActorUserId,
    actorIdentifier: row.logActorIdentifier,
    createdAt:
      normalizeTimestamp(row.logCreatedAt) ?? new Date(0).toISOString(),
  }));
}

export async function createResource(
  input: ResourceInput,
  options?: { ownerUserId?: string | null; includeAllWorkspaces?: boolean },
): Promise<ResourceCard> {
  await ensureSchema();
  const db = getDb();
  const normalizedOwnerUserId = normalizeActorUserId(options?.ownerUserId);

  const workspace = await resolveWorkspaceForInput(
    input.workspaceId,
    normalizedOwnerUserId,
    { includeAllWorkspaces: options?.includeAllWorkspaces },
  );
  const categoryName = normalizeCategoryName(input.category);

  const category = await ensureCategoryByName(
    categoryName,
    workspace.id,
    undefined,
    normalizedOwnerUserId,
  );

  const insertedCards = await db
    .insert(resourceCards)
    .values({
      workspaceId: workspace.id,
      category: category.name,
      ownerUserId: category.ownerUserId ?? null,
    })
    .returning({
      id: resourceCards.id,
    });

  const createdCard = insertedCards[0];
  if (!createdCard) {
    throw new Error("Failed to create resource card.");
  }

  if (input.links.length > 0) {
    await db.insert(resourceLinks).values(
      input.links.map((link, position) => ({
        resourceId: createdCard.id,
        url: link.url,
        label: link.label,
        note: link.note ?? null,
        position,
      })),
    );
  }

  await setTagsForResource(createdCard.id, input.tags);

  // Resolve and cache favicons for new links (non-blocking on failure)
  void seedFaviconCacheForUrls(input.links.map((l) => l.url));

  const resource = await findResourceById(createdCard.id, {
    includeDeleted: false,
  });
  if (!resource) {
    throw new Error("Failed to read created resource card.");
  }

  return resource;
}

export async function updateResource(
  id: string,
  input: ResourceInput,
  options?: { ownerUserId?: string | null; includeAllWorkspaces?: boolean },
): Promise<ResourceCard> {
  await ensureSchema();
  const db = getDb();
  const normalizedOwnerUserId = normalizeActorUserId(options?.ownerUserId);

  const existingRows = await db
    .select({
      workspaceId: resourceCards.workspaceId,
    })
    .from(resourceCards)
    .where(and(eq(resourceCards.id, id), isNull(resourceCards.deletedAt)))
    .limit(1);

  const existing = existingRows[0];
  if (!existing) {
    throw new ResourceNotFoundError(id);
  }

  const workspace = await resolveWorkspaceForInput(
    input.workspaceId ?? existing.workspaceId,
    normalizedOwnerUserId,
    { includeAllWorkspaces: options?.includeAllWorkspaces },
  );

  const categoryName = normalizeCategoryName(input.category);
  const category = await ensureCategoryByName(
    categoryName,
    workspace.id,
    undefined,
    normalizedOwnerUserId,
  );

  const updatedCards = await db
    .update(resourceCards)
    .set({
      workspaceId: workspace.id,
      category: category.name,
      ownerUserId: category.ownerUserId ?? null,
      updatedAt: sql`NOW()`,
    })
    .where(and(eq(resourceCards.id, id), isNull(resourceCards.deletedAt)))
    .returning({
      id: resourceCards.id,
    });

  if (updatedCards.length === 0) {
    throw new ResourceNotFoundError(id);
  }

  await db.delete(resourceLinks).where(eq(resourceLinks.resourceId, id));

  if (input.links.length > 0) {
    await db.insert(resourceLinks).values(
      input.links.map((link, position) => ({
        resourceId: id,
        url: link.url,
        label: link.label,
        note: link.note ?? null,
        position,
      })),
    );
  }

  await setTagsForResource(id, input.tags);

  // Resolve and cache favicons for any newly added links (non-blocking on failure)
  void seedFaviconCacheForUrls(input.links.map((l) => l.url));

  const resource = await findResourceById(id, { includeDeleted: false });
  if (!resource) {
    throw new ResourceNotFoundError(id);
  }

  return resource;
}

export async function deleteResource(
  id: string,
  actor?: ResourceAuditActor,
): Promise<void> {
  await ensureSchema();
  const db = getDb();

  const rows = await db
    .update(resourceCards)
    .set({
      deletedAt: sql`NOW()`,
      updatedAt: sql`NOW()`,
    })
    .where(and(eq(resourceCards.id, id), isNull(resourceCards.deletedAt)))
    .returning({ id: resourceCards.id });

  const archived = rows[0];
  if (!archived) {
    throw new ResourceNotFoundError(id);
  }

  await appendAuditLog(archived.id, "archived", actor);
}

export async function restoreResource(
  id: string,
  actor?: ResourceAuditActor,
): Promise<ResourceCard> {
  await ensureSchema();
  const db = getDb();

  const rows = await db
    .update(resourceCards)
    .set({
      deletedAt: null,
      updatedAt: sql`NOW()`,
    })
    .where(and(eq(resourceCards.id, id), isNotNull(resourceCards.deletedAt)))
    .returning({ id: resourceCards.id });

  const restored = rows[0];
  if (!restored) {
    throw new ResourceNotFoundError(id);
  }

  await appendAuditLog(restored.id, "restored", actor);

  const resource = await findResourceById(id, { includeDeleted: false });
  if (!resource) {
    throw new ResourceNotFoundError(id);
  }

  return resource;
}

export async function getResourceOwnerById(id: string): Promise<{
  id: string;
  ownerUserId: string | null;
  deletedAt: string | null;
} | null> {
  await ensureSchema();
  const db = getDb();

  const rows = await db
    .select({
      id: resourceCards.id,
      ownerUserId: resourceCards.ownerUserId,
      deletedAt: resourceCards.deletedAt,
    })
    .from(resourceCards)
    .where(eq(resourceCards.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    ownerUserId: row.ownerUserId ?? null,
    deletedAt: normalizeTimestamp(row.deletedAt),
  };
}

export async function updateResourceCategoryOwner(
  categoryId: string,
  ownerUserId: string | null,
): Promise<{
  category: ResourceCategory;
  updatedResources: number;
}> {
  await ensureSchema();
  const db = getDb();
  const normalizedOwnerUserId = normalizeActorUserId(ownerUserId);

  if (normalizedOwnerUserId) {
    const ownerRows = await db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(eq(appUsers.id, normalizedOwnerUserId))
      .limit(1);

    if (ownerRows.length === 0) {
      throw new Error("Owner user does not exist.");
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
    });

  const updatedCategory = categoryRows[0];
  if (!updatedCategory) {
    throw new ResourceCategoryNotFoundError(categoryId);
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
        sql`${normalizedCategorySql(resourceCards.category)} = ${normalizeCategoryNameLower(updatedCategory.name)}`,
      ),
    )
    .returning({ id: resourceCards.id });

  return {
    category: normalizeCategoryRow(updatedCategory as ResourceCategoryRow),
    updatedResources: updatedResources.length,
  };
}

export async function mergeDuplicateResourceCategories(options?: {
  workspaceId?: string | null;
}): Promise<MergeDuplicateCategoriesSummary> {
  await ensureSchema();
  const db = getDb();
  const normalizedWorkspaceId = options?.workspaceId?.trim() || null;

  const baseQuery = db
    .select({
      workspaceId: resourceCategories.workspaceId,
      name: resourceCategories.name,
    })
    .from(resourceCategories)
    .orderBy(asc(resourceCategories.workspaceId), asc(resourceCategories.createdAt));
  const rows = normalizedWorkspaceId
    ? await baseQuery.where(eq(resourceCategories.workspaceId, normalizedWorkspaceId))
    : await baseQuery;

  const groups = new Map<
    string,
    {
      workspaceId: string;
      normalizedName: string;
    }
  >();
  for (const row of rows) {
    const normalizedName = normalizeCategoryName(row.name);
    if (!normalizedName) {
      continue;
    }

    const normalizedKey = normalizeCategoryNameLower(normalizedName);
    const key = `${row.workspaceId}:${normalizedKey}`;
    if (groups.has(key)) {
      continue;
    }

    groups.set(key, {
      workspaceId: row.workspaceId,
      normalizedName,
    });
  }

  let processedGroups = 0;
  let mergedCategories = 0;
  let updatedResources = 0;

  for (const group of groups.values()) {
    const outcome = await mergeCategoriesInWorkspaceByNormalizedName(
      group.workspaceId,
      group.normalizedName,
    );
    if (!outcome) {
      continue;
    }

    processedGroups += 1;
    mergedCategories += outcome.mergedCategoryIds.length;
    updatedResources += outcome.updatedResources;
  }

  return {
    processedGroups,
    mergedCategories,
    updatedResources,
  };
}

export async function backfillResourceOwnershipToFirstAdmin(
  firstAdminUserId: string,
): Promise<void> {
  await ensureSchema();
  const db = getDb();

  const normalizedFirstAdminUserId = normalizeActorUserId(firstAdminUserId);
  if (!normalizedFirstAdminUserId) {
    return;
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
  `);

  await db
    .update(resourceCategories)
    .set({
      ownerUserId: normalizedFirstAdminUserId,
      updatedAt: sql`NOW()`,
    })
    .where(isNull(resourceCategories.ownerUserId));

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
  `);

  await db.execute(sql`
    UPDATE resource_cards AS rc
    SET
      owner_user_id = COALESCE(cat.owner_user_id, ${normalizedFirstAdminUserId}::uuid),
      updated_at = NOW()
    FROM resource_categories AS cat
    WHERE
      rc.workspace_id = cat.workspace_id
      AND lower(regexp_replace(btrim(rc.category), '[[:space:]]+', ' ', 'g')) =
          lower(regexp_replace(btrim(cat.name), '[[:space:]]+', ' ', 'g'))
      AND rc.owner_user_id IS DISTINCT FROM COALESCE(cat.owner_user_id, ${normalizedFirstAdminUserId}::uuid)
  `);

  await db
    .update(resourceCards)
    .set({
      ownerUserId: normalizedFirstAdminUserId,
      updatedAt: sql`NOW()`,
    })
    .where(isNull(resourceCards.ownerUserId));
}
