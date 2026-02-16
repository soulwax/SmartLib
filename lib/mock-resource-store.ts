import "server-only"

import { loadLibraryResourcesFromFile } from "@/lib/library-parser"
import type { ResourceCard, ResourceInput } from "@/lib/resources"
import { ResourceNotFoundError } from "@/lib/resource-repository"

let mockStore: ResourceCard[] | null = null

function cloneResource(resource: ResourceCard): ResourceCard {
  return {
    id: resource.id,
    category: resource.category,
    deletedAt: resource.deletedAt ?? null,
    links: resource.links.map((link) => ({ ...link })),
  }
}

function ensureMockStore() {
  if (mockStore !== null) {
    return
  }

  mockStore = loadLibraryResourcesFromFile().map((resource) => ({
    ...resource,
    deletedAt: resource.deletedAt ?? null,
  }))
}

export function resetMockStoreForTests() {
  mockStore = null
}

export async function hasAnyMockResources(): Promise<boolean> {
  ensureMockStore()
  return (mockStore ?? []).length > 0
}

export async function listMockResources(): Promise<ResourceCard[]> {
  ensureMockStore()
  return (mockStore ?? [])
    .filter((resource) => !resource.deletedAt)
    .map(cloneResource)
}

export async function listMockResourcesIncludingDeleted(): Promise<ResourceCard[]> {
  ensureMockStore()
  return (mockStore ?? []).map(cloneResource)
}

export async function createMockResource(input: ResourceInput): Promise<ResourceCard> {
  ensureMockStore()

  const created: ResourceCard = {
    id: crypto.randomUUID(),
    category: input.category,
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
  input: ResourceInput
): Promise<ResourceCard> {
  ensureMockStore()

  const index = (mockStore ?? []).findIndex(
    (resource) => resource.id === id && !resource.deletedAt
  )

  if (index < 0) {
    throw new ResourceNotFoundError(id)
  }

  const previous = (mockStore ?? [])[index]

  const updated: ResourceCard = {
    id,
    category: input.category,
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

export async function deleteMockResource(id: string): Promise<void> {
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
}

export async function restoreMockResource(id: string): Promise<ResourceCard> {
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

  return cloneResource(next[index])
}
