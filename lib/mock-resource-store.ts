import "server-only"

import { loadLibraryResourcesFromFile } from "@/lib/library-parser"
import {
  fallbackFaviconUrlForHostname,
  hostnameFromUrl,
} from "@/lib/favicon-service"
import type {
  ResourceCategory,
  ResourceAuditAction,
  ResourceAuditActor,
  ResourceAuditLogEntry,
  ResourceCard,
  ResourceInput,
  ResourceWorkspace,
} from "@/lib/resources"
import { DEFAULT_CATEGORY_SUGGESTIONS } from "@/lib/resources"
import {
  ResourceCategoryAlreadyExistsError,
  ResourceCategoryNotFoundError,
  ResourceNotFoundError,
  ResourceWorkspaceAlreadyExistsError,
  ResourceWorkspaceLimitReachedError,
  ResourceWorkspaceNotFoundError,
} from "@/lib/resource-repository"

let mockStore: ResourceCard[] | null = null
let mockAuditLogs: ResourceAuditLogEntry[] | null = null
let mockCategories: ResourceCategory[] | null = null
let mockWorkspaces: ResourceWorkspace[] | null = null

const MAIN_RESOURCE_WORKSPACE_NAME = "Main Workspace"
const DEFAULT_RESOURCE_CATEGORY_NAME = "General"
const FALLBACK_RESOURCE_CATEGORY_NAME = "Uncategorized"

function cloneResource(resource: ResourceCard): ResourceCard {
  return {
    id: resource.id,
    workspaceId: resource.workspaceId,
    category: resource.category,
    ownerUserId: resource.ownerUserId ?? null,
    tags: [...(resource.tags ?? [])],
    deletedAt: resource.deletedAt ?? null,
    links: resource.links.map((link) => {
      const hostname = hostnameFromUrl(link.url)
      const faviconUrl =
        link.faviconUrl ??
        (hostname ? fallbackFaviconUrlForHostname(hostname) : null)

      return {
        ...link,
        faviconUrl,
      }
    }),
  }
}

function cloneAuditLog(log: ResourceAuditLogEntry): ResourceAuditLogEntry {
  return {
    ...log,
  }
}

function cloneCategory(category: ResourceCategory): ResourceCategory {
  return {
    ...category,
  }
}

function cloneWorkspace(workspace: ResourceWorkspace): ResourceWorkspace {
  return {
    ...workspace,
  }
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

function normalizeActorUserId(userId?: string | null): string | null {
  return userId?.trim() || null
}

function isWorkspaceVisibleToUser(
  workspaceOwnerUserId: string | null | undefined,
  userId: string | null
): boolean {
  if (!workspaceOwnerUserId) {
    return userId === null
  }

  if (!userId) {
    return false
  }

  return workspaceOwnerUserId === userId
}

function ensureMainWorkspace(): ResourceWorkspace {
  const existing = (mockWorkspaces ?? []).find(
    (workspace) =>
      !workspace.ownerUserId &&
      workspace.name.toLowerCase() === MAIN_RESOURCE_WORKSPACE_NAME.toLowerCase()
  )

  if (existing) {
    return existing
  }

  const created: ResourceWorkspace = {
    id: crypto.randomUUID(),
    name: MAIN_RESOURCE_WORKSPACE_NAME,
    ownerUserId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  mockWorkspaces = [...(mockWorkspaces ?? []), created]
  return created
}

function requireVisibleWorkspace(
  workspaceId: string,
  actorUserId?: string | null,
  options?: { includeAllWorkspaces?: boolean }
): ResourceWorkspace {
  const normalizedActorUserId = normalizeActorUserId(actorUserId)
  const workspace = (mockWorkspaces ?? []).find((item) => item.id === workspaceId)

  if (!workspace) {
    throw new ResourceWorkspaceNotFoundError(workspaceId)
  }

  if (
    !options?.includeAllWorkspaces &&
    !isWorkspaceVisibleToUser(workspace.ownerUserId, normalizedActorUserId)
  ) {
    throw new ResourceWorkspaceNotFoundError(workspaceId)
  }

  return workspace
}

function ensureMockCategoryByName(
  name: string,
  workspaceId: string,
  ownerUserId?: string | null
): ResourceCategory {
  const normalizedName = normalizeCategoryName(name)
  const normalizedOwnerUserId = normalizeActorUserId(ownerUserId)

  if (!normalizedName) {
    throw new Error("Category name is required.")
  }

  const existing = (mockCategories ?? []).find(
    (category) =>
      category.workspaceId === workspaceId &&
      category.name.toLowerCase() === normalizedName.toLowerCase()
  )

  if (existing) {
    if (!existing.ownerUserId && normalizedOwnerUserId) {
      existing.ownerUserId = normalizedOwnerUserId
      existing.updatedAt = new Date().toISOString()
    }

    return existing
  }

  const nextCategory: ResourceCategory = {
    id: crypto.randomUUID(),
    workspaceId,
    name: normalizedName,
    ownerUserId: normalizedOwnerUserId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  mockCategories = [...(mockCategories ?? []), nextCategory]
  return nextCategory
}

function appendMockAuditLog(
  resource: ResourceCard,
  action: ResourceAuditAction,
  actor?: ResourceAuditActor
) {
  const { actorUserId, actorIdentifier } = normalizeAuditActor(actor)
  const next: ResourceAuditLogEntry = {
    id: crypto.randomUUID(),
    resourceId: resource.id,
    resourceCategory: resource.category,
    action,
    actorUserId,
    actorIdentifier,
    createdAt: new Date().toISOString(),
  }

  mockAuditLogs = [next, ...(mockAuditLogs ?? [])]
}

function ensureMockStore() {
  if (mockWorkspaces === null) {
    mockWorkspaces = []
  }

  const mainWorkspace = ensureMainWorkspace()

  if (mockStore === null) {
    mockStore = loadLibraryResourcesFromFile().map((resource) => ({
      ...resource,
      workspaceId: mainWorkspace.id,
      ownerUserId: resource.ownerUserId ?? null,
      tags: resource.tags ?? [],
      deletedAt: resource.deletedAt ?? null,
    }))
  }

  if (mockAuditLogs === null) {
    mockAuditLogs = []
  }

  if (mockCategories === null) {
    const seedNames = new Set<string>([
      DEFAULT_RESOURCE_CATEGORY_NAME,
      ...DEFAULT_CATEGORY_SUGGESTIONS,
      ...(mockStore ?? []).map((resource) => resource.category),
    ])

    mockCategories = [...seedNames]
      .map((name) => normalizeCategoryName(name))
      .filter((name) => name.length > 0)
      .map((name) => ({
        id: crypto.randomUUID(),
        workspaceId: mainWorkspace.id,
        name,
        ownerUserId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }))
  }
}

function listVisibleWorkspaceIds(
  userId?: string | null,
  options?: { includeAllWorkspaces?: boolean }
): string[] {
  if (options?.includeAllWorkspaces) {
    return (mockWorkspaces ?? []).map((workspace) => workspace.id)
  }

  const normalizedUserId = normalizeActorUserId(userId)

  return (mockWorkspaces ?? [])
    .filter((workspace) =>
      isWorkspaceVisibleToUser(workspace.ownerUserId, normalizedUserId)
    )
    .map((workspace) => workspace.id)
}

function findFirstOwnedWorkspace(userId: string): ResourceWorkspace | null {
  const workspace = [...(mockWorkspaces ?? [])]
    .filter((item) => item.ownerUserId === userId)
    .sort((left, right) =>
      (left.createdAt ?? "").localeCompare(right.createdAt ?? "")
    )[0]

  return workspace ?? null
}

function resolveWorkspaceForInput(
  workspaceId: string | undefined,
  actorUserId?: string | null,
  options?: { includeAllWorkspaces?: boolean }
): ResourceWorkspace {
  if (workspaceId?.trim()) {
    return requireVisibleWorkspace(workspaceId, actorUserId, options)
  }

  const normalizedActorUserId = normalizeActorUserId(actorUserId)
  if (normalizedActorUserId) {
    const ownedWorkspace = findFirstOwnedWorkspace(normalizedActorUserId)
    if (!ownedWorkspace) {
      throw new ResourceWorkspaceNotFoundError("personal-workspace")
    }

    return ownedWorkspace
  }

  return ensureMainWorkspace()
}

export function resetMockStoreForTests() {
  mockStore = null
  mockAuditLogs = null
  mockCategories = null
  mockWorkspaces = null
}

export async function hasAnyMockResources(): Promise<boolean> {
  ensureMockStore()
  return (mockStore ?? []).length > 0
}

export async function listMockResourceWorkspaces(options?: {
  userId?: string | null
  includeAllWorkspaces?: boolean
}): Promise<ResourceWorkspace[]> {
  ensureMockStore()

  const visibleWorkspaceIdSet = new Set(
    listVisibleWorkspaceIds(options?.userId, {
      includeAllWorkspaces: options?.includeAllWorkspaces,
    })
  )

  return [...(mockWorkspaces ?? [])]
    .filter((workspace) => visibleWorkspaceIdSet.has(workspace.id))
    .sort((left, right) => {
      const leftIsMain = !left.ownerUserId
      const rightIsMain = !right.ownerUserId
      if (leftIsMain !== rightIsMain) {
        return leftIsMain ? -1 : 1
      }

      return left.name.localeCompare(right.name)
    })
    .map(cloneWorkspace)
}

export async function createMockResourceWorkspace(
  name: string,
  ownerUserId: string
): Promise<ResourceWorkspace> {
  ensureMockStore()

  const normalizedName = normalizeWorkspaceName(name)
  const normalizedOwnerUserId = ownerUserId.trim()

  if (!normalizedOwnerUserId) {
    throw new Error("Workspace owner is required.")
  }

  if (!normalizedName) {
    throw new Error("Workspace name is required.")
  }

  const ownedWorkspaceCount = (mockWorkspaces ?? []).filter(
    (workspace) => (workspace.ownerUserId ?? null) === normalizedOwnerUserId
  ).length

  if (ownedWorkspaceCount >= 1) {
    throw new ResourceWorkspaceLimitReachedError(1)
  }

  const exists = (mockWorkspaces ?? []).some(
    (workspace) =>
      (workspace.ownerUserId ?? null) === normalizedOwnerUserId &&
      workspace.name.toLowerCase() === normalizedName.toLowerCase()
  )

  if (exists) {
    throw new ResourceWorkspaceAlreadyExistsError(normalizedName)
  }

  const created: ResourceWorkspace = {
    id: crypto.randomUUID(),
    name: normalizedName,
    ownerUserId: normalizedOwnerUserId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  mockWorkspaces = [...(mockWorkspaces ?? []), created]

  return cloneWorkspace(created)
}

export async function renameMockResourceWorkspace(
  id: string,
  name: string,
  ownerUserId: string,
): Promise<ResourceWorkspace> {
  ensureMockStore()

  const normalizedName = normalizeWorkspaceName(name)
  if (!normalizedName) {
    throw new Error("Workspace name is required.")
  }

  const index = (mockWorkspaces ?? []).findIndex(
    (w) => w.id === id && (w.ownerUserId ?? null) === ownerUserId,
  )

  if (index === -1) {
    throw new ResourceWorkspaceNotFoundError(id)
  }

  const nameConflict = (mockWorkspaces ?? []).some(
    (w, i) =>
      i !== index &&
      (w.ownerUserId ?? null) === ownerUserId &&
      w.name.toLowerCase() === normalizedName.toLowerCase(),
  )

  if (nameConflict) {
    throw new ResourceWorkspaceAlreadyExistsError(normalizedName)
  }

  const updated: ResourceWorkspace = {
    ...(mockWorkspaces![index] as ResourceWorkspace),
    name: normalizedName,
    updatedAt: new Date().toISOString(),
  }

  mockWorkspaces = (mockWorkspaces ?? []).map((w, i) => (i === index ? updated : w))

  return cloneWorkspace(updated)
}

export async function deleteMockResourceWorkspace(
  id: string,
  ownerUserId: string,
): Promise<void> {
  ensureMockStore()

  const exists = (mockWorkspaces ?? []).some(
    (w) => w.id === id && (w.ownerUserId ?? null) === ownerUserId,
  )

  if (!exists) {
    throw new ResourceWorkspaceNotFoundError(id)
  }

  mockWorkspaces = (mockWorkspaces ?? []).filter((w) => w.id !== id)
  mockStore = (mockStore ?? []).filter((r) => r.workspaceId !== id)
  mockCategories = (mockCategories ?? []).filter((c) => c.workspaceId !== id)
}

export async function listMockResources(options?: {
  userId?: string | null
  includeAllWorkspaces?: boolean
}): Promise<ResourceCard[]> {
  ensureMockStore()
  const visibleWorkspaceIdSet = new Set(
    listVisibleWorkspaceIds(options?.userId, {
      includeAllWorkspaces: options?.includeAllWorkspaces,
    })
  )

  return (mockStore ?? [])
    .filter((resource) => !resource.deletedAt)
    .filter((resource) => visibleWorkspaceIdSet.has(resource.workspaceId))
    .map(cloneResource)
}

export async function listMockResourcesIncludingDeleted(): Promise<ResourceCard[]> {
  ensureMockStore()
  return (mockStore ?? []).map(cloneResource)
}

export async function listMockResourceCategories(options?: {
  userId?: string | null
  workspaceId?: string | null
  includeAllWorkspaces?: boolean
}): Promise<ResourceCategory[]> {
  ensureMockStore()

  const visibleWorkspaceIds = listVisibleWorkspaceIds(options?.userId, {
    includeAllWorkspaces: options?.includeAllWorkspaces,
  })
  if (visibleWorkspaceIds.length === 0) {
    return []
  }

  const visibleWorkspaceIdSet = new Set(visibleWorkspaceIds)
  const scopedWorkspaceId = options?.workspaceId?.trim() || null

  if (scopedWorkspaceId && !visibleWorkspaceIdSet.has(scopedWorkspaceId)) {
    return []
  }

  return [...(mockCategories ?? [])]
    .filter((category) => visibleWorkspaceIdSet.has(category.workspaceId))
    .filter((category) =>
      scopedWorkspaceId ? category.workspaceId === scopedWorkspaceId : true
    )
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(cloneCategory)
}

export async function createMockResourceCategory(
  name: string,
  symbol?: string | null,
  options?: {
    workspaceId?: string
    ownerUserId?: string | null
    includeAllWorkspaces?: boolean
  }
): Promise<ResourceCategory> {
  ensureMockStore()

  const workspace = resolveWorkspaceForInput(
    options?.workspaceId,
    options?.ownerUserId,
    { includeAllWorkspaces: options?.includeAllWorkspaces }
  )

  const normalizedName = normalizeCategoryName(name)
  const existing = (mockCategories ?? []).find(
    (category) =>
      category.workspaceId === workspace.id &&
      category.name.toLowerCase() === normalizedName.toLowerCase()
  )

  if (existing) {
    throw new ResourceCategoryAlreadyExistsError(normalizedName)
  }

  const created = ensureMockCategoryByName(
    normalizedName,
    workspace.id,
    options?.ownerUserId ?? workspace.ownerUserId ?? null
  )
  created.symbol = normalizeCategorySymbol(symbol)
  created.updatedAt = new Date().toISOString()
  return cloneCategory(created)
}

export async function updateMockResourceCategory(
  categoryId: string,
  input: { name?: string; symbol?: string | null },
  options?: { actorUserId?: string | null; includeAllWorkspaces?: boolean }
): Promise<ResourceCategory> {
  ensureMockStore()

  const index = (mockCategories ?? []).findIndex(
    (category) => category.id === categoryId
  )
  if (index < 0) {
    throw new ResourceCategoryNotFoundError(categoryId)
  }

  const category = (mockCategories ?? [])[index]
  const workspace = requireVisibleWorkspace(
    category.workspaceId,
    options?.actorUserId,
    { includeAllWorkspaces: options?.includeAllWorkspaces }
  )
  if (!workspace) {
    throw new ResourceCategoryNotFoundError(categoryId)
  }

  const normalizedExistingName = normalizeCategoryName(category.name)
  const normalizedName =
    typeof input.name === "string"
      ? normalizeCategoryName(input.name)
      : normalizedExistingName
  const normalizedSymbol =
    input.symbol === undefined
      ? normalizeCategorySymbol(category.symbol)
      : normalizeCategorySymbol(input.symbol)

  if (!normalizedName) {
    throw new Error("Category name is required.")
  }

  const duplicate = (mockCategories ?? []).find(
    (item) =>
      item.id !== categoryId &&
      item.workspaceId === category.workspaceId &&
      item.name.toLowerCase() === normalizedName.toLowerCase()
  )
  if (duplicate) {
    throw new ResourceCategoryAlreadyExistsError(normalizedName)
  }

  const didNameChange = normalizedName !== normalizedExistingName

  const next = [...(mockCategories ?? [])]
  next[index] = {
    ...next[index],
    name: normalizedName,
    symbol: normalizedSymbol,
    updatedAt: new Date().toISOString(),
  }
  mockCategories = next

  if (didNameChange) {
    mockStore = (mockStore ?? []).map((resource) => {
      if (resource.workspaceId !== category.workspaceId) {
        return resource
      }

      if (resource.category.toLowerCase() !== normalizedExistingName.toLowerCase()) {
        return resource
      }

      return {
        ...resource,
        category: normalizedName,
        ownerUserId: next[index].ownerUserId ?? null,
      }
    })
  }

  return cloneCategory(next[index])
}

export async function updateMockResourceCategorySymbol(
  categoryId: string,
  symbol: string | null,
  options?: { actorUserId?: string | null; includeAllWorkspaces?: boolean }
): Promise<ResourceCategory> {
  return updateMockResourceCategory(
    categoryId,
    { symbol },
    {
      actorUserId: options?.actorUserId,
      includeAllWorkspaces: options?.includeAllWorkspaces,
    }
  )
}

export async function deleteMockResourceCategory(
  categoryId: string,
  options?: { actorUserId?: string | null; includeAllWorkspaces?: boolean }
): Promise<{
  deletedCategory: ResourceCategory
  reassignedCategory: ResourceCategory
  reassignedResources: number
}> {
  ensureMockStore()

  const existing = (mockCategories ?? []).find(
    (category) => category.id === categoryId
  )
  if (!existing) {
    throw new ResourceCategoryNotFoundError(categoryId)
  }

  const workspace = requireVisibleWorkspace(
    existing.workspaceId,
    options?.actorUserId,
    { includeAllWorkspaces: options?.includeAllWorkspaces }
  )
  if (!workspace) {
    throw new ResourceCategoryNotFoundError(categoryId)
  }

  const fallbackName =
    existing.name.toLowerCase() === DEFAULT_RESOURCE_CATEGORY_NAME.toLowerCase()
      ? FALLBACK_RESOURCE_CATEGORY_NAME
      : DEFAULT_RESOURCE_CATEGORY_NAME
  const reassignedCategory = ensureMockCategoryByName(
    fallbackName,
    existing.workspaceId,
    options?.actorUserId ?? workspace.ownerUserId ?? null
  )

  let reassignedResources = 0
  mockStore = (mockStore ?? []).map((resource) => {
    if (resource.workspaceId !== existing.workspaceId) {
      return resource
    }

    if (resource.category.toLowerCase() !== existing.name.toLowerCase()) {
      return resource
    }

    reassignedResources += 1
    return {
      ...resource,
      category: reassignedCategory.name,
      ownerUserId: reassignedCategory.ownerUserId ?? null,
    }
  })

  mockCategories = (mockCategories ?? []).filter(
    (category) => category.id !== categoryId
  )

  return {
    deletedCategory: cloneCategory(existing),
    reassignedCategory: cloneCategory(reassignedCategory),
    reassignedResources,
  }
}

export async function listMockResourceAuditLogs(
  limit = 200
): Promise<ResourceAuditLogEntry[]> {
  ensureMockStore()
  const boundedLimit = Math.max(1, Math.min(limit, 500))

  return (mockAuditLogs ?? []).slice(0, boundedLimit).map(cloneAuditLog)
}

export async function createMockResource(
  input: ResourceInput,
  options?: { ownerUserId?: string | null; includeAllWorkspaces?: boolean }
): Promise<ResourceCard> {
  ensureMockStore()

  const workspace = resolveWorkspaceForInput(
    input.workspaceId,
    options?.ownerUserId,
    { includeAllWorkspaces: options?.includeAllWorkspaces }
  )
  const category = ensureMockCategoryByName(
    input.category,
    workspace.id,
    options?.ownerUserId ?? workspace.ownerUserId ?? null
  )

  const created: ResourceCard = {
    id: crypto.randomUUID(),
    workspaceId: workspace.id,
    category: category.name,
    ownerUserId: category.ownerUserId ?? null,
    tags: input.tags,
    deletedAt: null,
    links: input.links.map((link) => ({
      id: crypto.randomUUID(),
      url: link.url,
      label: link.label,
      note: link.note,
    })),
  }

  mockStore = [created, ...(mockStore ?? [])]
  return cloneResource(created)
}

export async function updateMockResource(
  id: string,
  input: ResourceInput,
  options?: { ownerUserId?: string | null; includeAllWorkspaces?: boolean }
): Promise<ResourceCard> {
  ensureMockStore()

  const index = (mockStore ?? []).findIndex(
    (resource) => resource.id === id && !resource.deletedAt
  )

  if (index < 0) {
    throw new ResourceNotFoundError(id)
  }

  const previous = (mockStore ?? [])[index]
  const workspace = resolveWorkspaceForInput(
    input.workspaceId ?? previous.workspaceId,
    options?.ownerUserId,
    { includeAllWorkspaces: options?.includeAllWorkspaces }
  )
  const category = ensureMockCategoryByName(
    input.category,
    workspace.id,
    options?.ownerUserId ?? workspace.ownerUserId ?? null
  )

  const updated: ResourceCard = {
    id,
    workspaceId: workspace.id,
    category: category.name,
    ownerUserId: category.ownerUserId ?? null,
    tags: input.tags,
    deletedAt: previous.deletedAt ?? null,
    links: input.links.map((link) => ({
      id: crypto.randomUUID(),
      url: link.url,
      label: link.label,
      note: link.note,
    })),
  }

  const next = [...(mockStore ?? [])]
  next[index] = updated
  mockStore = next

  return cloneResource(updated)
}

export async function deleteMockResource(
  id: string,
  actor?: ResourceAuditActor
): Promise<void> {
  ensureMockStore()

  const index = (mockStore ?? []).findIndex(
    (resource) => resource.id === id && !resource.deletedAt
  )

  if (index < 0) {
    throw new ResourceNotFoundError(id)
  }

  const next = [...(mockStore ?? [])]
  next[index] = {
    ...next[index],
    deletedAt: new Date().toISOString(),
  }
  mockStore = next

  appendMockAuditLog(next[index], "archived", actor)
}

export async function restoreMockResource(
  id: string,
  actor?: ResourceAuditActor
): Promise<ResourceCard> {
  ensureMockStore()

  const index = (mockStore ?? []).findIndex(
    (resource) => resource.id === id && Boolean(resource.deletedAt)
  )

  if (index < 0) {
    throw new ResourceNotFoundError(id)
  }

  const next = [...(mockStore ?? [])]
  next[index] = {
    ...next[index],
    deletedAt: null,
  }
  mockStore = next

  appendMockAuditLog(next[index], "restored", actor)

  return cloneResource(next[index])
}
