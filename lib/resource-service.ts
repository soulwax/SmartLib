import "server-only";

import {
  ensureSuperAdminSeeded,
  findFirstAdminAuthUser,
} from "@/lib/auth-service";
import { hasDatabaseEnv, getBooleanEnv } from "@/lib/env";
import { loadLibraryResourcesFromFile } from "@/lib/library-parser";
import {
  createMockResourceCategory,
  createMockResourceOrganization,
  createMockResourceWorkspace,
  createMockResource,
  deleteMockResourceCategory,
  deleteMockResource,
  deleteMockResourceWorkspace,
  hasAnyMockResources,
  listMockResourceCategories,
  listMockResourceAuditLogs,
  listMockResourcesIncludingDeleted,
  listMockResourceOrganizations,
  listMockResourceWorkspaces,
  listMockResources,
  listMockResourcesPage,
  listMockResourceCountsByWorkspace,
  moveMockResourceItem,
  renameMockResourceWorkspace,
  updateMockResourceCategory,
  restoreMockResource,
  updateMockResource,
} from "@/lib/mock-resource-store";
import {
  createResourceCategory as createDbResourceCategory,
  createResourceOrganization as createDbResourceOrganization,
  createResourceWorkspace as createDbResourceWorkspace,
  createResource as createDbResource,
  backfillResourceOwnershipToFirstAdmin as backfillDbResourceOwnershipToFirstAdmin,
  deleteResourceCategory as deleteDbResourceCategory,
  deleteResource as deleteDbResource,
  deleteResourceWorkspace as deleteDbResourceWorkspace,
  hasAnyResources as hasAnyDbResources,
  listResourceCategories as listDbResourceCategories,
  listResourceAuditLogs as listDbResourceAuditLogs,
  listResourceOrganizations as listDbResourceOrganizations,
  listResourceCountsByWorkspace as listDbResourceCountsByWorkspace,
  listResourcesIncludingDeleted as listDbResourcesIncludingDeleted,
  listResourceWorkspaces as listDbResourceWorkspaces,
  listResources as listDbResources,
  listResourcesPage as listDbResourcesPage,
  moveResourceItem as moveDbResourceItem,
  mergeDuplicateResourceCategories as mergeDbDuplicateResourceCategories,
  renameResourceWorkspace as renameDbResourceWorkspace,
  updateResourceCategory as updateDbResourceCategory,
  restoreResource as restoreDbResource,
  updateResource as updateDbResource,
} from "@/lib/resource-repository";
import type {
  MoveResourceItemInput,
  MoveResourceItemResult,
  ResourceAuditActor,
  ResourceAuditLogEntry,
  ResourceCard,
  ResourceCategory,
  ResourceOrganization,
  ResourceInput,
  ResourceWorkspace,
} from "@/lib/resources";

export type ResourceDataMode = "database" | "mock";

let databaseBootstrap: Promise<void> | null = null;
const ENABLE_RESOURCE_STARTUP_MAINTENANCE = getBooleanEnv(
  "RESOURCE_STARTUP_MAINTENANCE",
  false,
);

function currentMode(): ResourceDataMode {
  return hasDatabaseEnv() ? "database" : "mock";
}

/**
 * Helper to run DB or mock logic based on mode.
 * Reduces repetition in service functions.
 */
async function withMode<T>(
  dbFn: () => Promise<T>,
  mockFn: () => Promise<T>,
): Promise<{ mode: ResourceDataMode; data: T }> {
  const mode = currentMode();
  if (mode === "database") {
    await ensureDatabaseBootstrapped();
    return { mode, data: await dbFn() };
  }
  return { mode, data: await mockFn() };
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
  };
}

/**
 * Ensures the database is bootstrapped and maintenance is run if needed.
 * Throws on error. Idempotent.
 */
async function ensureDatabaseBootstrapped() {
  if (databaseBootstrap !== null) {
    await databaseBootstrap;
    return;
  }

  databaseBootstrap = (async () => {
    await ensureSuperAdminSeeded();
    if (!ENABLE_RESOURCE_STARTUP_MAINTENANCE) {
      return;
    }

    const hasExistingResources = await hasAnyDbResources();
    const { user: firstAdminUser } = await findFirstAdminAuthUser();
    const firstAdminUserId = firstAdminUser?.id ?? null;

    const runMaintenance = async () => {
      if (firstAdminUserId) {
        await backfillDbResourceOwnershipToFirstAdmin(firstAdminUserId);
      }
      await mergeDbDuplicateResourceCategories();
    };

    if (hasExistingResources) {
      await runMaintenance();
      return;
    }

    const libraryResources = loadLibraryResourcesFromFile();
    if (libraryResources.length === 0) {
      await runMaintenance();
      return;
    }

    for (const resource of libraryResources) {
      await createDbResource(toResourceInput(resource), {
        ownerUserId: null,
      });
    }

    await runMaintenance();
  })();

  try {
    await databaseBootstrap;
  } catch (error) {
    databaseBootstrap = null;
    throw error;
  }
}

export async function listResourceWorkspacesService(options?: {
  userId?: string | null;
  organizationId?: string | null;
  includeAllWorkspaces?: boolean;
}): Promise<{ mode: ResourceDataMode; workspaces: ResourceWorkspace[] }> {
  return withMode(
    () =>
      listDbResourceWorkspaces({
        userId: options?.userId,
        organizationId: options?.organizationId,
        includeAllWorkspaces: options?.includeAllWorkspaces,
      }),
    () =>
      listMockResourceWorkspaces({
        userId: options?.userId,
        organizationId: options?.organizationId,
        includeAllWorkspaces: options?.includeAllWorkspaces,
      }),
  ).then(({ mode, data }) => ({ mode, workspaces: data }));
}

export async function listResourceOrganizationsService(options?: {
  userId?: string | null;
  includeAllWorkspaces?: boolean;
}): Promise<{ mode: ResourceDataMode; organizations: ResourceOrganization[] }> {
  return withMode(
    () =>
      listDbResourceOrganizations({
        userId: options?.userId,
        includeAllWorkspaces: options?.includeAllWorkspaces,
      }),
    () =>
      listMockResourceOrganizations({
        userId: options?.userId,
        includeAllWorkspaces: options?.includeAllWorkspaces,
      }),
  ).then(({ mode, data }) => ({ mode, organizations: data }));
}

export async function createResourceOrganizationService(
  name: string,
): Promise<{ mode: ResourceDataMode; organization: ResourceOrganization }> {
  const mode = currentMode();

  if (mode === "database") {
    return {
      mode,
      organization: await createDbResourceOrganization(name),
    };
  }

  return {
    mode,
    organization: await createMockResourceOrganization(name),
  };
}

export async function createResourceWorkspaceService(
  name: string,
  options: {
    ownerUserId: string;
    organizationId?: string | null;
    includeAllWorkspaces?: boolean;
  },
): Promise<{ mode: ResourceDataMode; workspace: ResourceWorkspace }> {
  const mode = currentMode();

  if (mode === "database") {
    return {
      mode,
      workspace: await createDbResourceWorkspace(name, options),
    };
  }

  return {
    mode,
    workspace: await createMockResourceWorkspace(name, options),
  };
}

export async function listResourcesService(options?: {
  userId?: string | null;
  workspaceId?: string | null;
  includeAllWorkspaces?: boolean;
}): Promise<{
  mode: ResourceDataMode;
  resources: ResourceCard[];
}> {
  const mode = currentMode();

  if (mode === "database") {
    await ensureDatabaseBootstrapped();

    return {
      mode,
      resources: await listDbResources({
        userId: options?.userId,
        workspaceId: options?.workspaceId,
        includeAllWorkspaces: options?.includeAllWorkspaces,
      }),
    };
  }

  return {
    mode,
    resources: await listMockResources({
      userId: options?.userId,
      workspaceId: options?.workspaceId,
      includeAllWorkspaces: options?.includeAllWorkspaces,
    }),
  };
}

export async function listResourcesPageService(options?: {
  userId?: string | null;
  workspaceId?: string | null;
  includeAllWorkspaces?: boolean;
  offset?: number;
  limit?: number;
}): Promise<{
  mode: ResourceDataMode;
  resources: ResourceCard[];
  nextOffset: number | null;
}> {
  const mode = currentMode();

  if (mode === "database") {
    await ensureDatabaseBootstrapped();

    const result = await listDbResourcesPage({
      userId: options?.userId,
      workspaceId: options?.workspaceId,
      includeAllWorkspaces: options?.includeAllWorkspaces,
      offset: options?.offset,
      limit: options?.limit,
    });
    return { mode, ...result };
  }

  const result = await listMockResourcesPage({
    userId: options?.userId,
    workspaceId: options?.workspaceId,
    includeAllWorkspaces: options?.includeAllWorkspaces,
    offset: options?.offset,
    limit: options?.limit,
  });
  return { mode, ...result };
}

export async function listResourceWorkspaceCountsService(options?: {
  userId?: string | null;
  includeAllWorkspaces?: boolean;
}): Promise<{
  mode: ResourceDataMode;
  countsByWorkspace: Record<string, number>;
}> {
  const mode = currentMode();

  if (mode === "database") {
    await ensureDatabaseBootstrapped();

    return {
      mode,
      countsByWorkspace: await listDbResourceCountsByWorkspace({
        userId: options?.userId,
        includeAllWorkspaces: options?.includeAllWorkspaces,
      }),
    };
  }

  return {
    mode,
    countsByWorkspace: await listMockResourceCountsByWorkspace({
      userId: options?.userId,
      includeAllWorkspaces: options?.includeAllWorkspaces,
    }),
  };
}

export async function listResourceCategoriesService(options?: {
  userId?: string | null;
  workspaceId?: string | null;
  includeAllWorkspaces?: boolean;
}): Promise<{
  mode: ResourceDataMode;
  categories: ResourceCategory[];
}> {
  const mode = currentMode();

  if (mode === "database") {
    await ensureDatabaseBootstrapped();

    return {
      mode,
      categories: await listDbResourceCategories({
        userId: options?.userId,
        workspaceId: options?.workspaceId,
        includeAllWorkspaces: options?.includeAllWorkspaces,
      }),
    };
  }

  return {
    mode,
    categories: await listMockResourceCategories({
      userId: options?.userId,
      workspaceId: options?.workspaceId,
      includeAllWorkspaces: options?.includeAllWorkspaces,
    }),
  };
}

export async function createResourceCategoryService(
  name: string,
  symbol?: string | null,
  options?: {
    workspaceId?: string;
    ownerUserId?: string | null;
    includeAllWorkspaces?: boolean;
  },
): Promise<{ mode: ResourceDataMode; category: ResourceCategory }> {
  const mode = currentMode();

  if (mode === "database") {
    await ensureDatabaseBootstrapped();

    return {
      mode,
      category: await createDbResourceCategory(name, symbol, options),
    };
  }

  return {
    mode,
    category: await createMockResourceCategory(name, symbol, options),
  };
}

export async function updateResourceCategorySymbolService(
  id: string,
  symbol: string | null,
  options?: { actorUserId?: string | null; includeAllWorkspaces?: boolean },
): Promise<{ mode: ResourceDataMode; category: ResourceCategory }> {
  return updateResourceCategoryService(
    id,
    { symbol },
    {
      actorUserId: options?.actorUserId,
      includeAllWorkspaces: options?.includeAllWorkspaces,
    },
  );
}

export async function updateResourceCategoryService(
  id: string,
  input: { name?: string; symbol?: string | null },
  options?: { actorUserId?: string | null; includeAllWorkspaces?: boolean },
): Promise<{ mode: ResourceDataMode; category: ResourceCategory }> {
  const mode = currentMode();

  if (mode === "database") {
    await ensureDatabaseBootstrapped();

    return {
      mode,
      category: await updateDbResourceCategory(id, input, options),
    };
  }

  return {
    mode,
    category: await updateMockResourceCategory(id, input, options),
  };
}

export async function deleteResourceCategoryService(
  id: string,
  options?: { actorUserId?: string | null; includeAllWorkspaces?: boolean },
): Promise<{
  mode: ResourceDataMode;
  deletedCategory: ResourceCategory;
  reassignedCategory: ResourceCategory;
  reassignedResources: number;
}> {
  const mode = currentMode();

  if (mode === "database") {
    await ensureDatabaseBootstrapped();

    const result = await deleteDbResourceCategory(id, options);
    return { mode, ...result };
  }

  const result = await deleteMockResourceCategory(id, options);
  return { mode, ...result };
}

export async function createResourceService(
  input: ResourceInput,
  options?: { ownerUserId?: string | null; includeAllWorkspaces?: boolean },
): Promise<{ mode: ResourceDataMode; resource: ResourceCard }> {
  const mode = currentMode();

  if (mode === "database") {
    await ensureDatabaseBootstrapped();

    return {
      mode,
      resource: await createDbResource(input, {
        ownerUserId: options?.ownerUserId ?? null,
        includeAllWorkspaces: options?.includeAllWorkspaces,
      }),
    };
  }

  return {
    mode,
    resource: await createMockResource(input, {
      ownerUserId: options?.ownerUserId ?? null,
      includeAllWorkspaces: options?.includeAllWorkspaces,
    }),
  };
}

export async function listResourcesIncludingDeletedService(): Promise<{
  mode: ResourceDataMode;
  resources: ResourceCard[];
}> {
  const mode = currentMode();

  if (mode === "database") {
    await ensureDatabaseBootstrapped();

    return {
      mode,
      resources: await listDbResourcesIncludingDeleted(),
    };
  }

  const hasResources = await hasAnyMockResources();
  if (!hasResources) {
    return { mode, resources: [] };
  }

  return {
    mode,
    resources: await listMockResourcesIncludingDeleted(),
  };
}

export async function updateResourceService(
  id: string,
  input: ResourceInput,
  options?: { ownerUserId?: string | null; includeAllWorkspaces?: boolean },
): Promise<{ mode: ResourceDataMode; resource: ResourceCard }> {
  const mode = currentMode();

  if (mode === "database") {
    await ensureDatabaseBootstrapped();

    return {
      mode,
      resource: await updateDbResource(id, input, {
        ownerUserId: options?.ownerUserId ?? null,
        includeAllWorkspaces: options?.includeAllWorkspaces,
      }),
    };
  }

  return {
    mode,
    resource: await updateMockResource(id, input, {
      ownerUserId: options?.ownerUserId ?? null,
      includeAllWorkspaces: options?.includeAllWorkspaces,
    }),
  };
}

export async function moveResourceItemService(
  input: MoveResourceItemInput,
  options?: { actorUserId?: string | null; includeAllWorkspaces?: boolean },
): Promise<{ mode: ResourceDataMode } & MoveResourceItemResult> {
  const mode = currentMode();

  if (mode === "database") {
    await ensureDatabaseBootstrapped();

    const result = await moveDbResourceItem(input, {
      actorUserId: options?.actorUserId ?? null,
      includeAllWorkspaces: options?.includeAllWorkspaces,
    });
    return { mode, ...result };
  }

  const result = await moveMockResourceItem(input, {
    actorUserId: options?.actorUserId ?? null,
    includeAllWorkspaces: options?.includeAllWorkspaces,
  });
  return { mode, ...result };
}

export async function deleteResourceService(
  id: string,
  actor?: ResourceAuditActor,
): Promise<{ mode: ResourceDataMode }> {
  const mode = currentMode();

  if (mode === "database") {
    await ensureDatabaseBootstrapped();

    await deleteDbResource(id, actor);
    return { mode };
  }

  await deleteMockResource(id, actor);
  return { mode };
}

export async function restoreResourceService(
  id: string,
  actor?: ResourceAuditActor,
): Promise<{ mode: ResourceDataMode; resource: ResourceCard }> {
  const mode = currentMode();

  if (mode === "database") {
    await ensureDatabaseBootstrapped();

    return {
      mode,
      resource: await restoreDbResource(id, actor),
    };
  }

  return {
    mode,
    resource: await restoreMockResource(id, actor),
  };
}

export async function listResourceAuditLogsService(
  limit = 200,
): Promise<{ mode: ResourceDataMode; logs: ResourceAuditLogEntry[] }> {
  const mode = currentMode();

  if (mode === "database") {
    await ensureDatabaseBootstrapped();

    return {
      mode,
      logs: await listDbResourceAuditLogs(limit),
    };
  }

  return {
    mode,
    logs: await listMockResourceAuditLogs(limit),
  };
}

export async function renameResourceWorkspaceService(
  id: string,
  name: string,
  ownerUserId: string,
): Promise<{ mode: ResourceDataMode; workspace: ResourceWorkspace }> {
  const mode = currentMode();

  if (mode === "database") {
    return {
      mode,
      workspace: await renameDbResourceWorkspace(id, name, ownerUserId),
    };
  }

  return {
    mode,
    workspace: await renameMockResourceWorkspace(id, name, ownerUserId),
  };
}

export async function deleteResourceWorkspaceService(
  id: string,
  ownerUserId: string,
): Promise<{ mode: ResourceDataMode }> {
  const mode = currentMode();

  if (mode === "database") {
    await deleteDbResourceWorkspace(id, ownerUserId);
    return { mode };
  }

  await deleteMockResourceWorkspace(id, ownerUserId);
  return { mode };
}
