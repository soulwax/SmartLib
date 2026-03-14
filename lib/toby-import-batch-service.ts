import "server-only"

import { and, desc, eq, inArray, isNull } from "drizzle-orm"

import { hasAdminAccess, type UserRole } from "@/lib/authorization"
import { getDb } from "@/lib/db"
import { resourceCards, tobyImportBatches } from "@/lib/db-schema"
import { hasDatabaseEnv } from "@/lib/env"
import { deleteResourceService } from "@/lib/resource-service"

const DEFAULT_BATCH_LIMIT = 6

export interface TobyImportBatchSummary {
  id: string
  workspaceId: string
  organizationId: string | null
  workspaceName: string
  sourceName: string | null
  createdWorkspaceId: string | null
  createdByUserId: string | null
  createdByIdentifier: string
  importedLists: number
  importedCards: number
  importedResources: number
  skippedExactDuplicates: number
  failed: number
  resourceCount: number
  rolledBackAt: string | null
  createdAt: string
}

export interface TobyImportBatchRollbackResult {
  batch: TobyImportBatchSummary
  archivedResources: number
  alreadyArchivedResources: number
  missingResources: number
  failedResources: number
  remainingActiveResources: number
  alreadyRolledBack: boolean
}

export class TobyImportBatchNotFoundError extends Error {
  constructor(batchId: string) {
    super(`Toby import batch ${batchId} was not found.`)
    this.name = "TobyImportBatchNotFoundError"
  }
}

export class TobyImportBatchAccessError extends Error {
  constructor() {
    super("You do not have access to roll back this Toby import.")
    this.name = "TobyImportBatchAccessError"
  }
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function normalizeResourceIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is string => typeof entry === "string")
}

function mapBatch(
  row: typeof tobyImportBatches.$inferSelect,
): TobyImportBatchSummary {
  const resourceIds = normalizeResourceIds(row.resourceIds)

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    organizationId: row.organizationId ?? null,
    workspaceName: row.workspaceName,
    sourceName: row.sourceName ?? null,
    createdWorkspaceId: row.createdWorkspaceId ?? null,
    createdByUserId: row.createdByUserId ?? null,
    createdByIdentifier: row.createdByIdentifier,
    importedLists: row.importedLists,
    importedCards: row.importedCards,
    importedResources: row.importedResources,
    skippedExactDuplicates: row.skippedExactDuplicates,
    failed: row.failed,
    resourceCount: resourceIds.length,
    rolledBackAt: toIsoString(row.rolledBackAt),
    createdAt: toIsoString(row.createdAt) ?? new Date(0).toISOString(),
  }
}

export function isTobyImportBatchStorageUnavailableError(error: unknown): boolean {
  if (!hasDatabaseEnv()) {
    return true
  }

  if (!(error instanceof Error)) {
    return false
  }

  const message = error.message.toLowerCase()
  return (
    message.includes("toby_import_batches") &&
    (message.includes("does not exist") ||
      message.includes("relation") ||
      message.includes("column"))
  )
}

export async function createTobyImportBatch(input: {
  actorUserId: string
  actorIdentifier: string
  workspaceId: string
  organizationId?: string | null
  workspaceName: string
  sourceName?: string | null
  createdWorkspaceId?: string | null
  importedLists: number
  importedCards: number
  importedResources: number
  skippedExactDuplicates: number
  failed: number
  resourceIds: string[]
}): Promise<TobyImportBatchSummary | null> {
  if (!hasDatabaseEnv()) {
    return null
  }

  const db = getDb()
  const [row] = await db
    .insert(tobyImportBatches)
    .values({
      createdByUserId: input.actorUserId,
      createdByIdentifier: input.actorIdentifier,
      workspaceId: input.workspaceId,
      organizationId: input.organizationId ?? null,
      workspaceName: input.workspaceName,
      sourceName: input.sourceName?.trim() ? input.sourceName.trim() : null,
      createdWorkspaceId: input.createdWorkspaceId ?? null,
      importedLists: input.importedLists,
      importedCards: input.importedCards,
      importedResources: input.importedResources,
      skippedExactDuplicates: input.skippedExactDuplicates,
      failed: input.failed,
      resourceIds: input.resourceIds,
    })
    .returning()

  return row ? mapBatch(row) : null
}

export async function listRecentTobyImportBatches(options: {
  userId: string
  workspaceId?: string | null
  limit?: number
}): Promise<TobyImportBatchSummary[]> {
  if (!hasDatabaseEnv()) {
    return []
  }

  const db = getDb()
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_BATCH_LIMIT, 12))
  const whereClause = options.workspaceId
    ? and(
        eq(tobyImportBatches.createdByUserId, options.userId),
        eq(tobyImportBatches.workspaceId, options.workspaceId),
      )
    : eq(tobyImportBatches.createdByUserId, options.userId)

  const rows = await db
    .select()
    .from(tobyImportBatches)
    .where(whereClause)
    .orderBy(desc(tobyImportBatches.createdAt))
    .limit(limit)

  return rows.map(mapBatch)
}

async function countRemainingActiveResources(resourceIds: string[]): Promise<number> {
  if (resourceIds.length === 0 || !hasDatabaseEnv()) {
    return 0
  }

  const db = getDb()
  const rows = await db
    .select({ id: resourceCards.id })
    .from(resourceCards)
    .where(
      and(
        inArray(resourceCards.id, resourceIds),
        isNull(resourceCards.deletedAt),
      ),
    )

  return rows.length
}

export async function rollbackTobyImportBatch(input: {
  batchId: string
  actorUserId: string
  actorIdentifier: string
  role: UserRole
}): Promise<TobyImportBatchRollbackResult> {
  if (!hasDatabaseEnv()) {
    throw new Error("Toby import history is only available in database mode.")
  }

  const db = getDb()
  const [batchRow] = await db
    .select()
    .from(tobyImportBatches)
    .where(eq(tobyImportBatches.id, input.batchId))
    .limit(1)

  if (!batchRow) {
    throw new TobyImportBatchNotFoundError(input.batchId)
  }

  if (
    batchRow.createdByUserId !== input.actorUserId &&
    !hasAdminAccess(input.role)
  ) {
    throw new TobyImportBatchAccessError()
  }

  const resourceIds = normalizeResourceIds(batchRow.resourceIds)

  if (batchRow.rolledBackAt) {
    return {
      batch: mapBatch(batchRow),
      archivedResources: 0,
      alreadyArchivedResources: 0,
      missingResources: 0,
      failedResources: 0,
      remainingActiveResources: await countRemainingActiveResources(resourceIds),
      alreadyRolledBack: true,
    }
  }

  const resourceRows =
    resourceIds.length > 0
      ? await db
          .select({
            id: resourceCards.id,
            deletedAt: resourceCards.deletedAt,
          })
          .from(resourceCards)
          .where(inArray(resourceCards.id, resourceIds))
      : []
  const resourcesById = new Map(resourceRows.map((row) => [row.id, row]))

  let archivedResources = 0
  let alreadyArchivedResources = 0
  let missingResources = 0
  let failedResources = 0

  for (const resourceId of resourceIds) {
    const resource = resourcesById.get(resourceId)

    if (!resource) {
      missingResources += 1
      continue
    }

    if (resource.deletedAt) {
      alreadyArchivedResources += 1
      continue
    }

    try {
      await deleteResourceService(resourceId, {
        userId: input.actorUserId,
        identifier: input.actorIdentifier,
      })
      archivedResources += 1
    } catch (error) {
      console.error("Failed to archive resource during toby import rollback", {
        resourceId,
        batchId: input.batchId,
        error,
      })
      failedResources += 1
    }
  }

  const remainingActiveResources =
    await countRemainingActiveResources(resourceIds)

  if (remainingActiveResources > 0) {
    return {
      batch: mapBatch(batchRow),
      archivedResources,
      alreadyArchivedResources,
      missingResources,
      failedResources,
      remainingActiveResources,
      alreadyRolledBack: false,
    }
  }

  const [updatedBatchRow] = await db
    .update(tobyImportBatches)
    .set({
      rolledBackAt: new Date(),
      rolledBackByUserId: input.actorUserId,
      rolledBackByIdentifier: input.actorIdentifier,
    })
    .where(eq(tobyImportBatches.id, input.batchId))
    .returning()

  return {
    batch: mapBatch(updatedBatchRow ?? batchRow),
    archivedResources,
    alreadyArchivedResources,
    missingResources,
    failedResources,
    remainingActiveResources: 0,
    alreadyRolledBack: false,
  }
}
