"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useSession } from "next-auth/react"

import type { ResourceCard } from "@/lib/resources"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ArrowLeft, ArchiveRestore, Trash2 } from "lucide-react"
import { Toaster, toast } from "sonner"

interface ApiErrorResponse {
  error?: string
  mode?: "database" | "mock"
}

interface AdminResourcesResponse extends ApiErrorResponse {
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

function formatDeletedAt(deletedAt: string | null | undefined): string {
  if (!deletedAt) {
    return "-"
  }

  const date = new Date(deletedAt)
  if (Number.isNaN(date.getTime())) {
    return deletedAt
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

export default function AdminPage() {
  const { data: session, status } = useSession()
  const [resources, setResources] = useState<ResourceCard[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [actionResourceId, setActionResourceId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const isAdmin = Boolean(session?.user?.isAdmin)

  const activeResources = useMemo(
    () => resources.filter((resource) => !resource.deletedAt),
    [resources]
  )

  const archivedResources = useMemo(
    () => resources.filter((resource) => Boolean(resource.deletedAt)),
    [resources]
  )

  const fetchResources = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)

    try {
      const response = await fetch("/api/admin/resources", { cache: "no-store" })
      const payload = await readJson<AdminResourcesResponse>(response)

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to load admin resources.")
      }

      setResources(payload?.resources ?? [])
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Could not load admin resources."
      )
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (status !== "authenticated" || !isAdmin) {
      setIsLoading(false)
      return
    }

    void fetchResources()
  }, [fetchResources, isAdmin, status])

  const archiveResource = useCallback(async (resourceId: string) => {
    setActionResourceId(resourceId)

    try {
      const response = await fetch(`/api/resources/${resourceId}`, {
        method: "DELETE",
      })
      const payload = await readJson<ApiErrorResponse>(response)

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to archive resource.")
      }

      setResources((prev) =>
        prev.map((resource) =>
          resource.id === resourceId
            ? { ...resource, deletedAt: new Date().toISOString() }
            : resource
        )
      )

      toast.success("Resource archived")
    } catch (error) {
      toast.error("Archive failed", {
        description:
          error instanceof Error ? error.message : "Could not archive resource.",
      })
    } finally {
      setActionResourceId(null)
    }
  }, [])

  const restoreResource = useCallback(async (resourceId: string) => {
    setActionResourceId(resourceId)

    try {
      const response = await fetch(`/api/admin/resources/${resourceId}/restore`, {
        method: "POST",
      })
      const payload = await readJson<ResourceResponse>(response)

      if (!response.ok || !payload?.resource) {
        throw new Error(payload?.error ?? "Failed to restore resource.")
      }

      const restored = payload.resource
      setResources((prev) =>
        prev.map((resource) => (resource.id === restored.id ? restored : resource))
      )

      toast.success("Resource restored")
    } catch (error) {
      toast.error("Restore failed", {
        description:
          error instanceof Error ? error.message : "Could not restore resource.",
      })
    } finally {
      setActionResourceId(null)
    }
  }, [])

  if (status === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
        Checking permissions...
      </div>
    )
  }

  if (status !== "authenticated") {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-semibold">Admin Panel</h1>
        <p className="text-sm text-muted-foreground">Sign in to access admin tools.</p>
        <Button asChild>
          <Link href="/">
            <ArrowLeft className="h-4 w-4" />
            <span className="ml-2">Back to Library</span>
          </Link>
        </Button>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-semibold">Admin Panel</h1>
        <p className="text-sm text-muted-foreground">
          You are signed in as read-only.
        </p>
        <Button asChild>
          <Link href="/">
            <ArrowLeft className="h-4 w-4" />
            <span className="ml-2">Back to Library</span>
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Admin Panel</h1>
          <p className="text-sm text-muted-foreground">
            Soft-delete management with restore support.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/">
            <ArrowLeft className="h-4 w-4" />
            <span className="ml-2">Back to Library</span>
          </Link>
        </Button>
      </header>

      {loadError ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Could not load resources</CardTitle>
            <CardDescription>{loadError}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => void fetchResources()} disabled={isLoading}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Active Resources</CardTitle>
            <CardDescription>{activeResources.length} visible in library</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : activeResources.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active resources.</p>
            ) : (
              activeResources.map((resource) => (
                <div
                  key={resource.id}
                  className="flex items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{resource.category}</p>
                    <p className="text-xs text-muted-foreground">
                      {resource.links.length} links
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">active</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void archiveResource(resource.id)}
                      disabled={actionResourceId === resource.id}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="ml-2">Archive</span>
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Archived Resources</CardTitle>
            <CardDescription>{archivedResources.length} hidden from library</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : archivedResources.length === 0 ? (
              <p className="text-sm text-muted-foreground">No archived resources.</p>
            ) : (
              archivedResources.map((resource) => (
                <div
                  key={resource.id}
                  className="flex items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{resource.category}</p>
                    <p className="text-xs text-muted-foreground">
                      Archived: {formatDeletedAt(resource.deletedAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">archived</Badge>
                    <Button
                      size="sm"
                      onClick={() => void restoreResource(resource.id)}
                      disabled={actionResourceId === resource.id}
                    >
                      <ArchiveRestore className="h-4 w-4" />
                      <span className="ml-2">Restore</span>
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Toaster position="bottom-right" theme="dark" />
    </div>
  )
}
