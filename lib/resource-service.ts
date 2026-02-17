import "server-only"

import { ensureSuperAdminSeeded, findFirstAdminAuthUser } from "@/lib/auth-service"
import { hasDatabaseEnv } from "@/lib/env"
import { loadLibraryResourcesFromFile } from "@/lib/library-parser"
import {
  createMockResourceCategory,
  createMockResourceWorkspace,
  createMockResource,
  deleteMockResourceCategory,
  deleteMockResource,
  hasAnyMockResources,
  listMockResourceCategories,
  listMockResourceAuditLogs,
  listMockResourcesIncludingDeleted,
  listMockResourceWorkspaces,
  listMockResources,
  updateMockResourceCategorySymbol,
  restoreMockResource,
  updateMockResource,
} from "@/lib/mock-resource-store"
import {
  createResourceCategory as createDbResourceCategory,
  createResourceWorkspace as createDbResourceWorkspace,
  createResource as createDbResource,
  backfillResourceOwnershipToFirstAdmin as backfillDbResourceOwnershipToFirstAdmin,
  deleteResourceCategory as deleteDbResourceCategory,
  deleteResource as deleteDbResource,
  hasAnyResources as hasAnyDbResources,
  listResourceCategories as listDbResourceCategories,
  listResourceAuditLogs as listDbResourceAuditLogs,
  listResourcesIncludingDeleted as listDbResourcesIncludingDeleted,
  listResourceWorkspaces as listDbResourceWorkspaces,
  listResources as listDbResources,
  updateResourceCategorySymbol as updateDbResourceCategorySymbol,
  restoreResource as restoreDbResource,
  updateResource as updateDbResource,
} from "@/lib/resource-repository"
import type {
  ResourceAuditActor,
  ResourceAuditLogEntry,
  ResourceCard,
  ResourceCategory,
  ResourceInput,
  ResourceWorkspace,
} from "@/lib/resources"

export type ResourceDataMode = "database" | "mock"

let databaseBootstrap: Promise<void> | null = null

function currentMode(): ResourceDataMode {
  return hasDatabaseEnv() ? "database" : "mock"
}

function toResourceInput(resource: ResourceCard): ResourceInput {
  return {
    category: resource.category,
    tags: resource.tags ?? [],
    links: resource.links.map((link) => ({
      url: link.url,
      label: link.label,
      note: link.note ?? undefined,
    })),
  }
}

async function ensureDatabaseBootstrapped() {
  if (databaseBootstrap !== null) {
    await databaseBootstrap
    return
  }

  databaseBootstrap = (async () => {
    await ensureSuperAdminSeeded()
    const { user: firstAdminUser } = await findFirstAdminAuthUser()
    const firstAdminUserId = firstAdminUser?.id ?? null

    if (firstAdminUserId) {
      await backfillDbResourceOwnershipToFirstAdmin(firstAdminUserId)
    }

    const hasExistingResources = await hasAnyDbResources()
    if (hasExistingResources) {
      return
    }

    const libraryResources = loadLibraryResourcesFromFile()
    if (libraryResources.length === 0) {
      return
    }

    for (const resource of libraryResources) {
      await createDbResource(toResourceInput(resource), {
        ownerUserId: null,
      })
    }

    if (firstAdminUserId) {
      await backfillDbResourceOwnershipToFirstAdmin(firstAdminUserId)
    }
  })()

  try {
    await databaseBootstrap
  } catch (error) {
    databaseBootstrap = null
    throw error
  }
}

export async function listResourceWorkspacesService(options?: {
  userId?: string | null
}): Promise<{ mode: ResourceDataMode; workspaces: ResourceWorkspace[] }> {
  const mode = currentMode()

  if (mode === "database") {
    await ensureDatabaseBootstrapped()

    return {
      mode,
      workspaces: await listDbResourceWorkspaces({ userId: options?.userId }),
    }
  }

  return {
    mode,
    workspaces: await listMockResourceWorkspaces({ userId: options?.userId }),
  }
}

export async function createResourceWorkspaceService(
  name: string,
  options: { ownerUserId: string }
): Promise<{ mode: ResourceDataMode; workspace: ResourceWorkspace }> {
  const mode = currentMode()

  if (mode === "database") {
    return {
      mode,
      workspace: await createDbResourceWorkspace(name, options.ownerUserId),
    }
  }

  return {
    mode,
    workspace: await createMockResourceWorkspace(name, options.ownerUserId),
  }
}

export async function listResourcesService(options?: {
  userId?: string | null
}): Promise<{
  mode: ResourceDataMode
  resources: ResourceCard[]
}> {
  const mode = currentMode()

  if (mode === "database") {
    await ensureDatabaseBootstrapped()

    return {
      mode,
      resources: await listDbResources({ userId: options?.userId }),
    }
  }

  return {
    mode,
    resources: await listMockResources({ userId: options?.userId }),
  }
}

export async function listResourceCategoriesService(options?: {
  userId?: string | null
  workspaceId?: string | null
}): Promise<{
  mode: ResourceDataMode
  categories: ResourceCategory[]
}> {
  const mode = currentMode()

  if (mode === "database") {
    await ensureDatabaseBootstrapped()

    return {
      mode,
      categories: await listDbResourceCategories({
        userId: options?.userId,
        workspaceId: options?.workspaceId,
      }),
    }
  }

  return {
    mode,
    categories: await listMockResourceCategories({
      userId: options?.userId,
      workspaceId: options?.workspaceId,
    }),
  }
}

export async function createResourceCategoryService(
  name: string,
  symbol?: string | null,
  options?: { workspaceId?: string; ownerUserId?: string | null }
): Promise<{ mode: ResourceDataMode; category: ResourceCategory }> {
  const mode = currentMode()

  if (mode === "database") {
    await ensureDatabaseBootstrapped()

    return {
      mode,
      category: await createDbResourceCategory(name, symbol, options),
    }
  }

  return {
    mode,
    category: await createMockResourceCategory(name, symbol, options),
  }
}

export async function updateResourceCategorySymbolService(
  id: string,
  symbol: string | null,
  options?: { actorUserId?: string | null }
): Promise<{ mode: ResourceDataMode; category: ResourceCategory }> {
  const mode = currentMode()

  if (mode === "database") {
    await ensureDatabaseBootstrapped()

    return {
      mode,
      category: await updateDbResourceCategorySymbol(id, symbol, options),
    }
  }

  return {
    mode,
    category: await updateMockResourceCategorySymbol(id, symbol, options),
  }
}

export async function deleteResourceCategoryService(
  id: string,
  options?: { actorUserId?: string | null }
): Promise<{
  mode: ResourceDataMode
  deletedCategory: ResourceCategory
  reassignedCategory: ResourceCategory
  reassignedResources: number
}> {
  const mode = currentMode()

  if (mode === "database") {
    await ensureDatabaseBootstrapped()

    const result = await deleteDbResourceCategory(id, options)
    return { mode, ...result }
  }

  const result = await deleteMockResourceCategory(id, options)
  return { mode, ...result }
}

export async function createResourceService(
  input: ResourceInput,
  options?: { ownerUserId?: string | null }
): Promise<{ mode: ResourceDataMode; resource: ResourceCard }> {
  const mode = currentMode()

  if (mode === "database") {
    await ensureDatabaseBootstrapped()

    return {
      mode,
      resource: await createDbResource(input, {
        ownerUserId: options?.ownerUserId ?? null,
      }),
    }
  }

  return {
    mode,
    resource: await createMockResource(input, {
      ownerUserId: options?.ownerUserId ?? null,
    }),
  }
}

export async function listResourcesIncludingDeletedService(): Promise<{
  mode: ResourceDataMode
  resources: ResourceCard[]
}> {
  const mode = currentMode()

  if (mode === "database") {
    await ensureDatabaseBootstrapped()

    return {
      mode,
      resources: await listDbResourcesIncludingDeleted(),
    }
  }

  const hasResources = await hasAnyMockResources()
  if (!hasResources) {
    return { mode, resources: [] }
  }

  return {
    mode,
    resources: await listMockResourcesIncludingDeleted(),
  }
}

export async function updateResourceService(
  id: string,
  input: ResourceInput,
  options?: { ownerUserId?: string | null }
): Promise<{ mode: ResourceDataMode; resource: ResourceCard }> {
  const mode = currentMode()

  if (mode === "database") {
    await ensureDatabaseBootstrapped()

    return {
      mode,
      resource: await updateDbResource(id, input, {
        ownerUserId: options?.ownerUserId ?? null,
      }),
    }
  }

  return {
    mode,
    resource: await updateMockResource(id, input, {
      ownerUserId: options?.ownerUserId ?? null,
    }),
  }
}

export async function deleteResourceService(
  id: string,
  actor?: ResourceAuditActor
): Promise<{ mode: ResourceDataMode }> {
  const mode = currentMode()

  if (mode === "database") {
    await ensureDatabaseBootstrapped()

    await deleteDbResource(id, actor)
    return { mode }
  }

  await deleteMockResource(id, actor)
  return { mode }
}

export async function restoreResourceService(
  id: string,
  actor?: ResourceAuditActor
): Promise<{ mode: ResourceDataMode; resource: ResourceCard }> {
  const mode = currentMode()

  if (mode === "database") {
    await ensureDatabaseBootstrapped()

    return {
      mode,
      resource: await restoreDbResource(id, actor),
    }
  }

  return {
    mode,
    resource: await restoreMockResource(id, actor),
  }
}

export async function listResourceAuditLogsService(
  limit = 200
): Promise<{ mode: ResourceDataMode; logs: ResourceAuditLogEntry[] }> {
  const mode = currentMode()

  if (mode === "database") {
    await ensureDatabaseBootstrapped()

    return {
      mode,
      logs: await listDbResourceAuditLogs(limit),
    }
  }

  return {
    mode,
    logs: await listMockResourceAuditLogs(limit),
  }
}
