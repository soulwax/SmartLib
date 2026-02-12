"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import type { ResourceCard, ResourceInput } from "@/lib/resources"
import { AddResourceModal } from "@/components/add-resource-modal"
import { CategorySidebar } from "@/components/category-sidebar"
import { ResourceCardItem } from "@/components/resource-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { BookOpen, FolderOpen, Menu, Plus, Search } from "lucide-react"
import { Toaster, toast } from "sonner"

interface ApiErrorResponse {
  error?: string
  mode?: "database" | "mock"
}

interface ListResourcesResponse extends ApiErrorResponse {
  mode?: "database" | "mock"
  resources?: ResourceCard[]
}

interface ResourceResponse extends ApiErrorResponse {
  mode?: "database" | "mock"
  resource?: ResourceCard
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T
  } catch {
    return null
  }
}

export default function Page() {
  const [resources, setResources] = useState<ResourceCard[]>([])
  const [activeCategory, setActiveCategory] = useState<string | "All">("All")
  const [searchQuery, setSearchQuery] = useState("")
  const [modalOpen, setModalOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [editingResource, setEditingResource] = useState<ResourceCard | null>(
    null
  )
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [deletingResourceId, setDeletingResourceId] = useState<string | null>(
    null
  )
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dataMode, setDataMode] = useState<"database" | "mock">("mock")

  const resourceCounts = useMemo(() => {
    const counts: Record<string, number> = {}

    for (const resource of resources) {
      counts[resource.category] = (counts[resource.category] ?? 0) + 1
    }

    return counts
  }, [resources])

  const categories = useMemo(() => {
    const unique = new Set<string>()
    for (const resource of resources) {
      const category = resource.category.trim()
      if (category.length > 0) {
        unique.add(category)
      }
    }

    return [...unique]
  }, [resources])

  const filteredResources = useMemo(() => {
    let result = resources

    if (activeCategory !== "All") {
      result = result.filter((resource) => resource.category === activeCategory)
    }

    if (searchQuery.trim()) {
      const normalizedSearchQuery = searchQuery.toLowerCase()
      result = result.filter(
        (resource) =>
          resource.category.toLowerCase().includes(normalizedSearchQuery) ||
          resource.links.some(
            (link) =>
              link.label.toLowerCase().includes(normalizedSearchQuery) ||
              link.url.toLowerCase().includes(normalizedSearchQuery) ||
              link.note?.toLowerCase().includes(normalizedSearchQuery)
          )
      )
    }

    return result
  }, [resources, activeCategory, searchQuery])

  const totalLinks = useMemo(
    () => resources.reduce((acc, resource) => acc + resource.links.length, 0),
    [resources]
  )

  const fetchResources = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)

    try {
      const response = await fetch("/api/resources", {
        cache: "no-store",
      })
      const payload = await readJson<ListResourcesResponse>(response)

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to load resources.")
      }

      setResources(payload?.resources ?? [])
      setDataMode(payload?.mode === "database" ? "database" : "mock")
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Failed to load resources. Check the database setup and retry."
      )
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchResources()
  }, [fetchResources])

  useEffect(() => {
    if (activeCategory !== "All" && !resourceCounts[activeCategory]) {
      setActiveCategory("All")
    }
  }, [activeCategory, resourceCounts])

  const handleSave = useCallback(
    async (input: ResourceInput) => {
      const isEditing = editingResource !== null
      setIsSaving(true)

      try {
        const response = await fetch(
          isEditing ? `/api/resources/${editingResource.id}` : "/api/resources",
          {
            method: isEditing ? "PUT" : "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(input),
          }
        )

        const payload = await readJson<ResourceResponse>(response)

        if (!response.ok || !payload?.resource) {
          throw new Error(payload?.error ?? "Failed to save resource.")
        }

        const savedResource = payload.resource
        if (payload.mode) {
          setDataMode(payload.mode)
        }

        setResources((prev) => {
          if (!isEditing) {
            return [savedResource, ...prev]
          }

          return prev.map((resource) =>
            resource.id === savedResource.id ? savedResource : resource
          )
        })

        setEditingResource(null)
        setModalOpen(false)

        toast.success(isEditing ? "Resource updated" : "Resource added", {
          description: `${savedResource.category} card saved to your library.`,
        })
      } catch (error) {
        toast.error("Save failed", {
          description:
            error instanceof Error
              ? error.message
              : "Could not save this resource.",
        })
      } finally {
        setIsSaving(false)
      }
    },
    [editingResource]
  )

  const handleDelete = useCallback(async (resourceId: string) => {
    setDeletingResourceId(resourceId)

    try {
      const response = await fetch(`/api/resources/${resourceId}`, {
        method: "DELETE",
      })
      const payload = await readJson<ApiErrorResponse>(response)

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to delete resource.")
      }

      if (payload?.mode) {
        setDataMode(payload.mode)
      }

      setResources((prev) => prev.filter((resource) => resource.id !== resourceId))
      toast.success("Resource removed", {
        description: "The card has been deleted from your library.",
      })
    } catch (error) {
      toast.error("Delete failed", {
        description:
          error instanceof Error
            ? error.message
            : "Could not delete this resource.",
      })
    } finally {
      setDeletingResourceId(null)
    }
  }, [])

  const handleEdit = useCallback((resource: ResourceCard) => {
    setEditingResource(resource)
    setModalOpen(true)
  }, [])

  const handleModalOpenChange = useCallback((open: boolean) => {
    setModalOpen(open)
    if (!open) {
      setEditingResource(null)
    }
  }, [])

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-3 lg:px-6">
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground lg:hidden"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open category menu"
        >
          <Menu className="h-5 w-5" />
        </Button>

        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <BookOpen className="h-4 w-4" />
          </div>
          <div className="hidden sm:block">
            <h1 className="text-base font-semibold leading-tight text-foreground">
              DevVault
            </h1>
            <p className="text-xs text-muted-foreground">
              {resources.length} cards &middot; {totalLinks} links
              {dataMode === "mock" ? " · mock mode" : ""}
            </p>
          </div>
        </div>

        <div className="relative mx-4 max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search resources..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="pl-9"
            aria-label="Search resources"
          />
        </div>

        <Button
          onClick={() => {
            setEditingResource(null)
            setModalOpen(true)
          }}
          className="ml-auto gap-2"
          size="sm"
          disabled={isLoading || Boolean(loadError)}
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Add Resource</span>
        </Button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside
          className="hidden w-60 shrink-0 border-r border-border bg-card lg:block"
          aria-label="Category navigation"
        >
          <CategorySidebar
            categories={categories}
            activeCategory={activeCategory}
            onCategoryChange={setActiveCategory}
            resourceCounts={resourceCounts}
          />
        </aside>

        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-72 p-0">
            <SheetHeader className="px-4 pt-4">
              <SheetTitle>Categories</SheetTitle>
              <SheetDescription className="sr-only">
                Filter resources by category
              </SheetDescription>
            </SheetHeader>
            <CategorySidebar
              categories={categories}
              activeCategory={activeCategory}
              onCategoryChange={(category) => {
                setActiveCategory(category)
                setSidebarOpen(false)
              }}
              resourceCounts={resourceCounts}
            />
          </SheetContent>
        </Sheet>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6" aria-label="Resource cards">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-sm text-muted-foreground">Loading resources...</p>
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
              <h2 className="text-lg font-semibold text-foreground">
                Unable to load resources
              </h2>
              <p className="max-w-xl text-sm text-muted-foreground">{loadError}</p>
              <Button onClick={() => void fetchResources()} size="sm">
                Retry
              </Button>
            </div>
          ) : filteredResources.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
                <FolderOpen className="h-8 w-8" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  {searchQuery ? "No results found" : "No resources yet"}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {searchQuery
                    ? `Nothing matches "${searchQuery}". Try a different search.`
                    : "Add your first resource to get started!"}
                </p>
              </div>
              {!searchQuery && (
                <Button
                  onClick={() => {
                    setEditingResource(null)
                    setModalOpen(true)
                  }}
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add Resource
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {filteredResources.map((resource) => (
                <ResourceCardItem
                  key={resource.id}
                  resource={resource}
                  onDelete={handleDelete}
                  onEdit={handleEdit}
                  isDeleting={deletingResourceId === resource.id}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      <AddResourceModal
        open={modalOpen}
        onOpenChange={handleModalOpenChange}
        onSave={handleSave}
        editingResource={editingResource}
        isSaving={isSaving}
        categorySuggestions={categories}
      />

      <Toaster position="bottom-right" theme="dark" />
    </div>
  )
}
