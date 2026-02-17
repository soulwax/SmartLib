import "server-only"

import { loadLibraryResourcesFromFile } from "@/lib/library-parser"
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
    links: resource.links.map((link) => ({ ...link })),
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
    return true
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
  actorUserId?: string | null
): ResourceWorkspace {
  const normalizedActorUserId = normalizeActorUserId(actorUserId)
  const workspace = (mockWorkspaces ?? []).find((item) => item.id === workspaceId)

  if (!workspace) {
    throw new ResourceWorkspaceNotFoundError(workspaceId)
  }

  if (!isWorkspaceVisibleToUser(workspace.ownerUserId, normalizedActorUserId)) {
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

function listVisibleWorkspaceIds(userId?: string | null): string[] {
  const normalizedUserId = normalizeActorUserId(userId)

  return (mockWorkspaces ?? [])
    .filter((workspace) =>
      isWorkspaceVisibleToUser(workspace.ownerUserId, normalizedUserId)
    )
    .map((workspace) => workspace.id)
}

function resolveWorkspaceForInput(
  workspaceId: string | undefined,
  actorUserId?: string | null
): ResourceWorkspace {
  if (workspaceId?.trim()) {
    return requireVisibleWorkspace(workspaceId, actorUserId)
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
}): Promise<ResourceWorkspace[]> {
  ensureMockStore()

  const visibleWorkspaceIdSet = new Set(listVisibleWorkspaceIds(options?.userId))

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

export async function listMockResources(options?: {
  userId?: string | null
}): Promise<ResourceCard[]> {
  ensureMockStore()
  const visibleWorkspaceIdSet = new Set(listVisibleWorkspaceIds(options?.userId))

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
}): Promise<ResourceCategory[]> {
  ensureMockStore()

  const visibleWorkspaceIds = listVisibleWorkspaceIds(options?.userId)
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
  options?: { workspaceId?: string; ownerUserId?: string | null }
): Promise<ResourceCategory> {
  ensureMockStore()

  const workspace = resolveWorkspaceForInput(
    options?.workspaceId,
    options?.ownerUserId
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

export async function updateMockResourceCategorySymbol(
  categoryId: string,
  symbol: string | null,
  options?: { actorUserId?: string | null }
): Promise<ResourceCategory> {
  ensureMockStore()

  const index = (mockCategories ?? []).findIndex(
    (category) => category.id === categoryId
  )
  if (index < 0) {
    throw new ResourceCategoryNotFoundError(categoryId)
  }

  const category = (mockCategories ?? [])[index]
  const workspace = requireVisibleWorkspace(category.workspaceId, options?.actorUserId)
  if (!workspace) {
    throw new ResourceCategoryNotFoundError(categoryId)
  }

  const next = [...(mockCategories ?? [])]
  next[index] = {
    ...next[index],
    symbol: normalizeCategorySymbol(symbol),
    updatedAt: new Date().toISOString(),
  }
  mockCategories = next

  return cloneCategory(next[index])
}

export async function deleteMockResourceCategory(
  categoryId: string,
  options?: { actorUserId?: string | null }
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

  const workspace = requireVisibleWorkspace(existing.workspaceId, options?.actorUserId)
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
  options?: { ownerUserId?: string | null }
): Promise<ResourceCard> {
  ensureMockStore()

  const workspace = resolveWorkspaceForInput(input.workspaceId, options?.ownerUserId)
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
  options?: { ownerUserId?: string | null }
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
    options?.ownerUserId
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
