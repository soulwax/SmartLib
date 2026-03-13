"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useSession } from "next-auth/react"

import type { ResourceAuditLogEntry, ResourceCard } from "@/lib/resources"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  ArrowLeft,
  ArchiveRestore,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Database,
  FilterX,
  LayoutDashboard,
  List,
  ScrollText,
  Search,
  Tag,
  Trash2,
  UserPlus,
} from "lucide-react"
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

interface AuditLogsResponse extends ApiErrorResponse {
  mode?: "database" | "mock"
  logs?: ResourceAuditLogEntry[]
}

interface FaviconAdminEntry {
  hostname: string
  sourceUrl: string | null
  sourceKind: "site" | "google" | "generated" | "unknown"
  hasStoredImage: boolean
  hasValidators: boolean
  lastCheckedAt: string | null
  lastChangedAt: string | null
  nextCheckAt: string | null
}

interface FaviconAdminStats {
  trackedHostnames: number
  cachedHostnames: number
  uncachedHostnames: number
  coveragePercent: number
  dueNowCount: number
  storedPayloadCount: number
  generatedFallbackCount: number
  validatorBackedCount: number
  checkedLastWindowCount: number
  changedLast24HoursCount: number
  lastCheckedAt: string | null
}

interface FaviconAdminResponse extends ApiErrorResponse {
  revalidateAfterHours?: number
  stats?: FaviconAdminStats
  dueEntries?: FaviconAdminEntry[]
  recentChecks?: FaviconAdminEntry[]
}

interface PromoteAdminResponse extends ApiErrorResponse {
  user?: {
    id: string
    email: string
    isAdmin: boolean
    isFirstAdmin: boolean
  }
}

type StatusFilter = "all" | "active" | "archived"
type SortOption =
  | "category-asc"
  | "category-desc"
  | "links-desc"
  | "links-asc"
  | "created-newest"
  | "created-oldest"
  | "archived-newest"
  | "archived-oldest"
type AdminSection = "overview" | "users" | "resources" | "audit"

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const
const AUDIT_PAGE_SIZE = 15
const AUDIT_FETCH_LIMIT = 200

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T
  } catch {
    return null
  }
}

function formatTs(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function isArchived(resource: ResourceCard): boolean {
  return Boolean(resource.deletedAt)
}

function toTimestamp(value: string | null | undefined): number {
  if (!value) return -1
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? -1 : parsed
}

function dedupeIds(ids: string[]): string[] {
  return [...new Set(ids)]
}

function truncateUuid(id: string): string {
  return id.slice(0, 8) + "…"
}

function formatSourceKind(sourceKind: FaviconAdminEntry["sourceKind"]): string {
  switch (sourceKind) {
    case "site":
      return "Site"
    case "google":
      return "Google"
    case "generated":
      return "Generated"
    default:
      return "Unknown"
  }
}

function sourceKindBadgeClass(sourceKind: FaviconAdminEntry["sourceKind"]): string {
  switch (sourceKind) {
    case "site":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
    case "google":
      return "border-sky-500/30 bg-sky-500/10 text-sky-600"
    case "generated":
      return "border-amber-500/30 bg-amber-500/10 text-amber-600"
    default:
      return ""
  }
}

async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success("Copied to clipboard")
  } catch {
    toast.error("Clipboard unavailable")
  }
}

function UuidCell({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted-foreground/50">—</span>
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
            onClick={() => void copyToClipboard(value)}
          >
            <span>{truncateUuid(value)}</span>
            <ClipboardCopy className="h-3 w-3 opacity-50" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="break-all font-mono text-xs">{value}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export default function AdminPage() {
  const { data: session, status } = useSession()
  const [resources, setResources] = useState<ResourceCard[]>([])
  const [auditLogs, setAuditLogs] = useState<ResourceAuditLogEntry[]>([])
  const [dataMode, setDataMode] = useState<"database" | "mock" | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isAuditLoading, setIsAuditLoading] = useState(true)
  const [isFaviconLoading, setIsFaviconLoading] = useState(true)
  const [actionResourceId, setActionResourceId] = useState<string | null>(null)
  const [isBulkActing, setIsBulkActing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [faviconError, setFaviconError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [sortOption, setSortOption] = useState<SortOption>("created-newest")
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(25)
  const [resourcePage, setResourcePage] = useState(1)
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>([])
  const [auditPage, setAuditPage] = useState(1)
  const [expandedResourceIds, setExpandedResourceIds] = useState<Set<string>>(new Set())
  const [activeSection, setActiveSection] = useState<AdminSection>("overview")
  const [promoteIdentifier, setPromoteIdentifier] = useState("")
  const [isPromotingAdmin, setIsPromotingAdmin] = useState(false)
  const [faviconStats, setFaviconStats] = useState<FaviconAdminStats | null>(null)
  const [faviconDueEntries, setFaviconDueEntries] = useState<FaviconAdminEntry[]>([])
  const [faviconRecentChecks, setFaviconRecentChecks] = useState<FaviconAdminEntry[]>([])
  const [faviconRevalidateHours, setFaviconRevalidateHours] = useState<number>(8)

  const isAdmin = Boolean(session?.user?.isAdmin)
  const isFirstAdmin = Boolean(session?.user?.isFirstAdmin)
  const canSubmitPromote =
    isFirstAdmin && promoteIdentifier.trim().length > 0 && !isPromotingAdmin

  const resourcesById = useMemo(
    () => new Map(resources.map((r) => [r.id, r])),
    [resources],
  )

  useEffect(() => {
    setSelectedResourceIds((prev) => prev.filter((id) => resourcesById.has(id)))
  }, [resourcesById])

  const totalResources = resources.length
  const archivedCount = useMemo(() => resources.filter(isArchived).length, [resources])
  const activeCount = totalResources - archivedCount
  const totalLinks = useMemo(() => resources.reduce((n, r) => n + r.links.length, 0), [resources])
  const totalTags = useMemo(
    () => new Set(resources.flatMap((r) => r.tags)).size,
    [resources],
  )

  const filteredResources = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()

    const filtered = resources.filter((r) => {
      if (statusFilter === "active" && isArchived(r)) return false
      if (statusFilter === "archived" && !isArchived(r)) return false
      if (!q) return true
      if (r.category.toLowerCase().includes(q)) return true
      if (r.id.toLowerCase().includes(q)) return true
      if (r.workspaceId.toLowerCase().includes(q)) return true
      if (r.ownerUserId?.toLowerCase().includes(q)) return true
      return r.links.some(
        (l) =>
          l.label.toLowerCase().includes(q) ||
          l.url.toLowerCase().includes(q) ||
          l.note?.toLowerCase().includes(q),
      )
    })

    filtered.sort((a, b) => {
      const catSort = a.category.localeCompare(b.category, undefined, { sensitivity: "base" })
      switch (sortOption) {
        case "category-asc": return catSort
        case "category-desc": return -catSort
        case "links-desc": return b.links.length - a.links.length || catSort
        case "links-asc": return a.links.length - b.links.length || catSort
        case "created-newest": return toTimestamp(b.createdAt) - toTimestamp(a.createdAt) || catSort
        case "created-oldest": return toTimestamp(a.createdAt) - toTimestamp(b.createdAt) || catSort
        case "archived-newest": return toTimestamp(b.deletedAt) - toTimestamp(a.deletedAt) || catSort
        case "archived-oldest": return toTimestamp(a.deletedAt) - toTimestamp(b.deletedAt) || catSort
        default: return catSort
      }
    })

    return filtered
  }, [resources, searchQuery, sortOption, statusFilter])

  const hasActiveFilters =
    searchQuery.trim().length > 0 || statusFilter !== "all" || sortOption !== "created-newest"

  const resourcePageCount = Math.max(1, Math.ceil(filteredResources.length / pageSize))

  useEffect(() => { setResourcePage(1) }, [pageSize, searchQuery, sortOption, statusFilter])
  useEffect(() => {
    if (resourcePage > resourcePageCount) setResourcePage(resourcePageCount)
  }, [resourcePage, resourcePageCount])

  const pagedResources = useMemo(() => {
    const start = (resourcePage - 1) * pageSize
    return filteredResources.slice(start, start + pageSize)
  }, [filteredResources, pageSize, resourcePage])

  const selectedIdSet = useMemo(() => new Set(selectedResourceIds), [selectedResourceIds])
  const pagedResourceIds = useMemo(() => pagedResources.map((r) => r.id), [pagedResources])

  const selectedOnPageCount = useMemo(
    () => pagedResourceIds.reduce((n, id) => n + (selectedIdSet.has(id) ? 1 : 0), 0),
    [pagedResourceIds, selectedIdSet],
  )

  const pageSelectState: boolean | "indeterminate" =
    pagedResourceIds.length === 0
      ? false
      : selectedOnPageCount === pagedResourceIds.length
        ? true
        : selectedOnPageCount > 0
          ? "indeterminate"
          : false

  const selectedActiveIds = useMemo(
    () => selectedResourceIds.filter((id) => !isArchived(resourcesById.get(id)!)),
    [resourcesById, selectedResourceIds],
  )

  const selectedArchivedIds = useMemo(
    () => selectedResourceIds.filter((id) => isArchived(resourcesById.get(id)!)),
    [resourcesById, selectedResourceIds],
  )

  const auditPageCount = Math.max(1, Math.ceil(auditLogs.length / AUDIT_PAGE_SIZE))
  useEffect(() => {
    if (auditPage > auditPageCount) setAuditPage(auditPageCount)
  }, [auditPage, auditPageCount])

  const pagedAuditLogs = useMemo(() => {
    const start = (auditPage - 1) * AUDIT_PAGE_SIZE
    return auditLogs.slice(start, start + AUDIT_PAGE_SIZE)
  }, [auditLogs, auditPage])

  const resetFilters = useCallback(() => {
    setSearchQuery("")
    setStatusFilter("all")
    setSortOption("created-newest")
  }, [])

  const fetchResources = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const response = await fetch("/api/admin/resources", { cache: "no-store" })
      const payload = await readJson<AdminResourcesResponse>(response)
      if (!response.ok) throw new Error(payload?.error ?? "Failed to load admin resources.")
      setResources(payload?.resources ?? [])
      setDataMode(payload?.mode ?? null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load admin resources.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  const fetchAuditLogs = useCallback(async () => {
    setIsAuditLoading(true)
    setAuditError(null)
    try {
      const response = await fetch(`/api/admin/audit?limit=${AUDIT_FETCH_LIMIT}`, { cache: "no-store" })
      const payload = await readJson<AuditLogsResponse>(response)
      if (!response.ok) throw new Error(payload?.error ?? "Failed to load audit logs.")
      setAuditLogs(payload?.logs ?? [])
    } catch (error) {
      setAuditError(error instanceof Error ? error.message : "Could not load audit logs.")
    } finally {
      setIsAuditLoading(false)
    }
  }, [])

  const fetchFaviconHealth = useCallback(async () => {
    setIsFaviconLoading(true)
    setFaviconError(null)
    try {
      const response = await fetch("/api/admin/favicon-cache", { cache: "no-store" })
      const payload = await readJson<FaviconAdminResponse>(response)
      if (!response.ok) throw new Error(payload?.error ?? "Failed to load favicon cache snapshot.")
      setFaviconStats(payload?.stats ?? null)
      setFaviconDueEntries(payload?.dueEntries ?? [])
      setFaviconRecentChecks(payload?.recentChecks ?? [])
      setFaviconRevalidateHours(payload?.revalidateAfterHours ?? 8)
    } catch (error) {
      setFaviconError(
        error instanceof Error ? error.message : "Could not load favicon cache snapshot."
      )
    } finally {
      setIsFaviconLoading(false)
    }
  }, [])

  useEffect(() => {
    if (status !== "authenticated" || !isAdmin) {
      setIsLoading(false)
      setIsAuditLoading(false)
      setIsFaviconLoading(false)
      return
    }
    void fetchResources()
    void fetchAuditLogs()
    void fetchFaviconHealth()
  }, [fetchAuditLogs, fetchFaviconHealth, fetchResources, isAdmin, status])

  const requestArchive = useCallback(async (resourceId: string) => {
    const response = await fetch(`/api/resources/${resourceId}`, { method: "DELETE" })
    const payload = await readJson<ApiErrorResponse>(response)
    if (!response.ok) throw new Error(payload?.error ?? "Failed to archive resource.")
  }, [])

  const requestRestore = useCallback(async (resourceId: string) => {
    const response = await fetch(`/api/admin/resources/${resourceId}/restore`, { method: "POST" })
    const payload = await readJson<ResourceResponse>(response)
    if (!response.ok || !payload?.resource) throw new Error(payload?.error ?? "Failed to restore resource.")
    return payload.resource
  }, [])

  const archiveResource = useCallback(
    async (resourceId: string) => {
      if (isBulkActing || actionResourceId !== null) return
      setActionResourceId(resourceId)
      try {
        await requestArchive(resourceId)
        const archivedAt = new Date().toISOString()
        setResources((prev) =>
          prev.map((r) => (r.id === resourceId ? { ...r, deletedAt: archivedAt } : r)),
        )
        setSelectedResourceIds((prev) => prev.filter((id) => id !== resourceId))
        toast.success("Resource archived")
        void fetchAuditLogs()
      } catch (error) {
        toast.error("Archive failed", {
          description: error instanceof Error ? error.message : "Could not archive resource.",
        })
      } finally {
        setActionResourceId(null)
      }
    },
    [actionResourceId, fetchAuditLogs, isBulkActing, requestArchive],
  )

  const restoreResource = useCallback(
    async (resourceId: string) => {
      if (isBulkActing || actionResourceId !== null) return
      setActionResourceId(resourceId)
      try {
        const restored = await requestRestore(resourceId)
        setResources((prev) => prev.map((r) => (r.id === restored.id ? restored : r)))
        setSelectedResourceIds((prev) => prev.filter((id) => id !== resourceId))
        toast.success("Resource restored")
        void fetchAuditLogs()
      } catch (error) {
        toast.error("Restore failed", {
          description: error instanceof Error ? error.message : "Could not restore resource.",
        })
      } finally {
        setActionResourceId(null)
      }
    },
    [actionResourceId, fetchAuditLogs, isBulkActing, requestRestore],
  )

  const archiveSelected = useCallback(async () => {
    if (isBulkActing || actionResourceId !== null) return
    if (selectedActiveIds.length === 0) { toast("No active resources selected."); return }
    setIsBulkActing(true)
    try {
      const settled = await Promise.allSettled(
        selectedActiveIds.map(async (id) => { await requestArchive(id); return id }),
      )
      const archivedAt = new Date().toISOString()
      const succeededIds: string[] = []
      let firstError: string | null = null
      for (const result of settled) {
        if (result.status === "fulfilled") succeededIds.push(result.value)
        else if (!firstError) firstError = result.reason instanceof Error ? result.reason.message : "Unexpected error."
      }
      if (succeededIds.length > 0) {
        const succeededSet = new Set(succeededIds)
        setResources((prev) =>
          prev.map((r) => (succeededSet.has(r.id) ? { ...r, deletedAt: archivedAt } : r)),
        )
        setSelectedResourceIds((prev) => prev.filter((id) => !succeededSet.has(id)))
        toast.success(`Archived ${succeededIds.length} resource${succeededIds.length === 1 ? "" : "s"}.`)
        void fetchAuditLogs()
      }
      const failedCount = settled.length - succeededIds.length
      if (failedCount > 0) toast.error(`${failedCount} failed to archive.`, { description: firstError ?? undefined })
    } finally {
      setIsBulkActing(false)
    }
  }, [actionResourceId, fetchAuditLogs, isBulkActing, requestArchive, selectedActiveIds])

  const restoreSelected = useCallback(async () => {
    if (isBulkActing || actionResourceId !== null) return
    if (selectedArchivedIds.length === 0) { toast("No archived resources selected."); return }
    setIsBulkActing(true)
    try {
      const settled = await Promise.allSettled(selectedArchivedIds.map(requestRestore))
      const restoredMap = new Map<string, ResourceCard>()
      let firstError: string | null = null
      for (const result of settled) {
        if (result.status === "fulfilled") restoredMap.set(result.value.id, result.value)
        else if (!firstError) firstError = result.reason instanceof Error ? result.reason.message : "Unexpected error."
      }
      if (restoredMap.size > 0) {
        setResources((prev) => prev.map((r) => restoredMap.get(r.id) ?? r))
        setSelectedResourceIds((prev) => prev.filter((id) => !restoredMap.has(id)))
        toast.success(`Restored ${restoredMap.size} resource${restoredMap.size === 1 ? "" : "s"}.`)
        void fetchAuditLogs()
      }
      const failedCount = settled.length - restoredMap.size
      if (failedCount > 0) toast.error(`${failedCount} failed to restore.`, { description: firstError ?? undefined })
    } finally {
      setIsBulkActing(false)
    }
  }, [actionResourceId, fetchAuditLogs, isBulkActing, requestRestore, selectedArchivedIds])

  const handlePromoteAdmin = useCallback(async () => {
    if (!isFirstAdmin || !canSubmitPromote) return

    setIsPromotingAdmin(true)
    try {
      const response = await fetch("/api/auth/admins", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          identifier: promoteIdentifier.trim(),
        }),
      })
      const payload = await readJson<PromoteAdminResponse>(response)
      if (!response.ok || !payload?.user) {
        throw new Error(payload?.error ?? "Failed to promote admin.")
      }

      setPromoteIdentifier("")
      toast.success("Admin promoted", {
        description: `${payload.user.email} can now manage resources.`,
      })
    } catch (error) {
      toast.error("Promotion failed", {
        description:
          error instanceof Error ? error.message : "Could not promote this user.",
      })
    } finally {
      setIsPromotingAdmin(false)
    }
  }, [canSubmitPromote, isFirstAdmin, promoteIdentifier])

  const togglePageSelection = useCallback(
    (checked: boolean) => {
      setSelectedResourceIds((prev) => {
        const next = new Set(prev)
        for (const id of pagedResourceIds) checked ? next.add(id) : next.delete(id)
        return [...next]
      })
    },
    [pagedResourceIds],
  )

  const toggleResourceSelection = useCallback((id: string, checked: boolean) => {
    setSelectedResourceIds((prev) =>
      checked ? dedupeIds([...prev, id]) : prev.filter((s) => s !== id),
    )
  }, [])

  const toggleExpanded = useCallback((id: string) => {
    setExpandedResourceIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  // ── Guard states ──────────────────────────────────────────────────────────

  if (status === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
        Checking permissions...
      </div>
    )
  }

  if (status !== "authenticated" || !isAdmin) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-semibold">Admin Panel</h1>
        <p className="text-sm text-muted-foreground">
          {status !== "authenticated" ? "Sign in to access admin tools." : "You are signed in as read-only."}
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

  // ── Pagination helpers ────────────────────────────────────────────────────

  const pageStartIndex = filteredResources.length === 0 ? 0 : (resourcePage - 1) * pageSize + 1
  const pageEndIndex = Math.min(resourcePage * pageSize, filteredResources.length)
  const auditStartIndex = auditLogs.length === 0 ? 0 : (auditPage - 1) * AUDIT_PAGE_SIZE + 1
  const auditEndIndex = Math.min(auditPage * AUDIT_PAGE_SIZE, auditLogs.length)

  // ── Nav items ─────────────────────────────────────────────────────────────

  const navItems: { id: AdminSection; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: "overview", label: "Overview", icon: <LayoutDashboard className="h-4 w-4" /> },
    { id: "users", label: "User Management", icon: <UserPlus className="h-4 w-4" /> },
    { id: "resources", label: "Resources", icon: <List className="h-4 w-4" />, count: totalResources },
    { id: "audit", label: "Audit Log", icon: <ScrollText className="h-4 w-4" />, count: auditLogs.length },
  ]

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-border bg-card px-6 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold">Admin Panel</h1>
          {dataMode ? (
            <Badge variant={dataMode === "database" ? "secondary" : "outline"} className="gap-1 text-[10px]">
              <Database className="h-2.5 w-2.5" />
              {dataMode}
            </Badge>
          ) : null}
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/">
            <ArrowLeft className="h-4 w-4" />
            <span className="ml-2">Library</span>
          </Link>
        </Button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-52 shrink-0 border-r border-border bg-card">
          <nav className="flex flex-col gap-1 p-3">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  activeSection === item.id
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <span className="flex items-center gap-2">
                  {item.icon}
                  {item.label}
                </span>
                {item.count !== undefined ? (
                  <span className="rounded-full bg-secondary px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                    {item.count}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>

          <div className="border-t border-border/70 p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Session
            </p>
            <p className="truncate text-xs font-medium text-foreground">
              {session?.user?.name ?? session?.user?.email?.split("@")[0] ?? "Admin"}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">{session?.user?.email}</p>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-auto p-6">

          {/* ── OVERVIEW ─────────────────────────────────────────────── */}
          {activeSection === "overview" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">Overview</h2>
                <p className="text-sm text-muted-foreground">Database snapshot and statistics.</p>
              </div>

              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Card>
                  <CardHeader className="pb-1">
                    <CardDescription>Total records</CardDescription>
                    <CardTitle className="text-3xl">{totalResources}</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 text-xs text-muted-foreground">All, including archived</CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1">
                    <CardDescription>Active</CardDescription>
                    <CardTitle className="text-3xl text-emerald-500">{activeCount}</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 text-xs text-muted-foreground">Visible in library</CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1">
                    <CardDescription>Archived</CardDescription>
                    <CardTitle className="text-3xl text-amber-500">{archivedCount}</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 text-xs text-muted-foreground">Soft-deleted, recoverable</CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1">
                    <CardDescription>Total links</CardDescription>
                    <CardTitle className="text-3xl">{totalLinks}</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 text-xs text-muted-foreground">Across all resources</CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                <Card>
                  <CardHeader className="pb-1">
                    <CardDescription>Unique tags</CardDescription>
                    <CardTitle className="text-2xl">{totalTags}</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 text-xs text-muted-foreground">Distinct tag values</CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1">
                    <CardDescription>Audit events</CardDescription>
                    <CardTitle className="text-2xl">{auditLogs.length}</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 text-xs text-muted-foreground">Last {AUDIT_FETCH_LIMIT} loaded</CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1">
                    <CardDescription>Archive rate</CardDescription>
                    <CardTitle className="text-2xl">
                      {totalResources > 0 ? Math.round((archivedCount / totalResources) * 100) : 0}%
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 text-xs text-muted-foreground">
                    {archivedCount} of {totalResources} archived
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                  <div>
                    <CardTitle className="text-sm">Favicon Cache Health</CardTitle>
                    <CardDescription>
                      Neon-backed cache coverage with lazy {faviconRevalidateHours}-hour revalidation.
                    </CardDescription>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void fetchFaviconHealth()}
                    disabled={isFaviconLoading}
                  >
                    {isFaviconLoading ? "Refreshing..." : "Refresh"}
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  {faviconError ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                      {faviconError}
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                        <div className="rounded-lg border border-border/70 bg-background/40 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            Coverage
                          </p>
                          <p className="mt-2 text-2xl font-semibold">
                            {faviconStats?.coveragePercent ?? 0}%
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {faviconStats?.cachedHostnames ?? 0} / {faviconStats?.trackedHostnames ?? 0} tracked
                          </p>
                        </div>
                        <div className="rounded-lg border border-border/70 bg-background/40 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            Due now
                          </p>
                          <p className="mt-2 text-2xl font-semibold">
                            {faviconStats?.dueNowCount ?? 0}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {faviconStats?.checkedLastWindowCount ?? 0} checked in last window
                          </p>
                        </div>
                        <div className="rounded-lg border border-border/70 bg-background/40 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            Stored bytes
                          </p>
                          <p className="mt-2 text-2xl font-semibold">
                            {faviconStats?.storedPayloadCount ?? 0}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {faviconStats?.validatorBackedCount ?? 0} validator-backed
                          </p>
                        </div>
                        <div className="rounded-lg border border-border/70 bg-background/40 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            Generated
                          </p>
                          <p className="mt-2 text-2xl font-semibold">
                            {faviconStats?.generatedFallbackCount ?? 0}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {faviconStats?.uncachedHostnames ?? 0} still uncached
                          </p>
                        </div>
                        <div className="rounded-lg border border-border/70 bg-background/40 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            Changed 24h
                          </p>
                          <p className="mt-2 text-2xl font-semibold">
                            {faviconStats?.changedLast24HoursCount ?? 0}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Last check {formatTs(faviconStats?.lastCheckedAt)}
                          </p>
                        </div>
                      </div>

                      <div className="grid gap-4 xl:grid-cols-2">
                        <Card className="border-border/70">
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm">Due for Revalidation</CardTitle>
                            <CardDescription>
                              Oldest rows waiting for the next conditional check.
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="p-0">
                            {faviconDueEntries.length === 0 ? (
                              <div className="px-6 py-5 text-sm text-muted-foreground">
                                No favicon rows are currently due.
                              </div>
                            ) : (
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Hostname</TableHead>
                                    <TableHead className="w-28">Source</TableHead>
                                    <TableHead className="w-20">Bytes</TableHead>
                                    <TableHead className="w-24">Validators</TableHead>
                                    <TableHead className="w-40">Last checked</TableHead>
                                    <TableHead className="w-40">Next check</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {faviconDueEntries.map((entry) => (
                                    <TableRow key={`due-${entry.hostname}`}>
                                      <TableCell>
                                        <div className="font-medium">{entry.hostname}</div>
                                      </TableCell>
                                      <TableCell>
                                        <Badge
                                          variant="outline"
                                          className={sourceKindBadgeClass(entry.sourceKind)}
                                        >
                                          {formatSourceKind(entry.sourceKind)}
                                        </Badge>
                                      </TableCell>
                                      <TableCell className="text-xs text-muted-foreground">
                                        {entry.hasStoredImage ? "stored" : "url-only"}
                                      </TableCell>
                                      <TableCell className="text-xs text-muted-foreground">
                                        {entry.hasValidators ? "yes" : "no"}
                                      </TableCell>
                                      <TableCell className="text-xs text-muted-foreground">
                                        {formatTs(entry.lastCheckedAt)}
                                      </TableCell>
                                      <TableCell className="text-xs text-muted-foreground">
                                        {formatTs(entry.nextCheckAt)}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            )}
                          </CardContent>
                        </Card>

                        <Card className="border-border/70">
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm">Recently Checked</CardTitle>
                            <CardDescription>
                              Most recently revalidated favicon rows.
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="p-0">
                            {faviconRecentChecks.length === 0 ? (
                              <div className="px-6 py-5 text-sm text-muted-foreground">
                                No favicon rows have been checked yet.
                              </div>
                            ) : (
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Hostname</TableHead>
                                    <TableHead className="w-28">Source</TableHead>
                                    <TableHead className="w-24">Validators</TableHead>
                                    <TableHead className="w-40">Last checked</TableHead>
                                    <TableHead className="w-40">Last changed</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {faviconRecentChecks.map((entry) => (
                                    <TableRow key={`recent-${entry.hostname}`}>
                                      <TableCell>
                                        <div className="font-medium">{entry.hostname}</div>
                                      </TableCell>
                                      <TableCell>
                                        <Badge
                                          variant="outline"
                                          className={sourceKindBadgeClass(entry.sourceKind)}
                                        >
                                          {formatSourceKind(entry.sourceKind)}
                                        </Badge>
                                      </TableCell>
                                      <TableCell className="text-xs text-muted-foreground">
                                        {entry.hasValidators ? "yes" : "no"}
                                      </TableCell>
                                      <TableCell className="text-xs text-muted-foreground">
                                        {formatTs(entry.lastCheckedAt)}
                                      </TableCell>
                                      <TableCell className="text-xs text-muted-foreground">
                                        {formatTs(entry.lastChangedAt)}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            )}
                          </CardContent>
                        </Card>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Recent audit events */}
              {auditLogs.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Recent activity</CardTitle>
                    <CardDescription>Last 5 audit events.</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-48">When</TableHead>
                          <TableHead className="w-28">Action</TableHead>
                          <TableHead>Resource</TableHead>
                          <TableHead>Actor</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {auditLogs.slice(0, 5).map((log) => (
                          <TableRow key={log.id}>
                            <TableCell className="text-xs text-muted-foreground">{formatTs(log.createdAt)}</TableCell>
                            <TableCell>
                              {log.action === "archived" ? (
                                <Badge variant="destructive">archived</Badge>
                              ) : (
                                <Badge variant="secondary">restored</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <span className="text-sm font-medium">{log.resourceCategory}</span>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{log.actorIdentifier}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* ── USER MANAGEMENT ─────────────────────────────────────── */}
          {activeSection === "users" && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">User Management</h2>
                <p className="text-sm text-muted-foreground">
                  Promote existing users who have already signed in.
                </p>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Promote to Admin</CardTitle>
                  <CardDescription>
                    Enter an email or username to grant admin access.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <form
                    className="flex flex-col gap-2 sm:flex-row"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void handlePromoteAdmin()
                    }}
                  >
                    <Input
                      value={promoteIdentifier}
                      onChange={(event) => setPromoteIdentifier(event.target.value)}
                      placeholder="user@example.com"
                      aria-label="Email or username"
                      disabled={!isFirstAdmin || isPromotingAdmin}
                    />
                    <Button
                      type="submit"
                      className="sm:w-auto"
                      disabled={!canSubmitPromote}
                    >
                      {isPromotingAdmin ? "Promoting..." : "Promote to Admin"}
                    </Button>
                  </form>

                  <p className="text-xs text-muted-foreground">
                    {isFirstAdmin
                      ? "FirstAdmin can grant admin access to existing users."
                      : "Only FirstAdmin can promote admins."}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ── RESOURCES ────────────────────────────────────────────── */}
          {activeSection === "resources" && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Resource Records</h2>
                <p className="text-sm text-muted-foreground">All resources including archived. Click a row to expand full details.</p>
              </div>

              {/* Filters */}
              <Card>
                <CardContent className="grid grid-cols-1 gap-3 pt-4 md:grid-cols-[2fr_1fr_1fr_auto]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search category, ID, URL, owner…"
                      className="pl-9"
                    />
                  </div>
                  <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                    <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="active">Active only</SelectItem>
                      <SelectItem value="archived">Archived only</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={sortOption} onValueChange={(v) => setSortOption(v as SortOption)}>
                    <SelectTrigger><SelectValue placeholder="Sort" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="created-newest">Created newest</SelectItem>
                      <SelectItem value="created-oldest">Created oldest</SelectItem>
                      <SelectItem value="category-asc">Category A–Z</SelectItem>
                      <SelectItem value="category-desc">Category Z–A</SelectItem>
                      <SelectItem value="links-desc">Most links</SelectItem>
                      <SelectItem value="links-asc">Fewest links</SelectItem>
                      <SelectItem value="archived-newest">Archived newest</SelectItem>
                      <SelectItem value="archived-oldest">Archived oldest</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" onClick={resetFilters} disabled={!hasActiveFilters}>
                    <FilterX className="h-4 w-4" /><span className="ml-2">Reset</span>
                  </Button>
                </CardContent>
              </Card>

              {loadError && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Could not load resources</CardTitle>
                    <CardDescription>{loadError}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button onClick={() => void fetchResources()} disabled={isLoading}>Retry</Button>
                  </CardContent>
                </Card>
              )}

              <Card className="overflow-hidden">
                <CardContent className="space-y-0 p-0">
                  {/* Bulk action bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                    <p className="text-xs text-muted-foreground">
                      {selectedResourceIds.length} selected
                      {selectedResourceIds.length > 0
                        ? ` · ${selectedActiveIds.length} active · ${selectedArchivedIds.length} archived`
                        : ""}
                      {" · "}
                      <span>{filteredResources.length} matching</span>
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => setSelectedResourceIds([])}
                        disabled={selectedResourceIds.length === 0 || isBulkActing || actionResourceId !== null}>
                        Clear
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => void archiveSelected()}
                        disabled={selectedActiveIds.length === 0 || isBulkActing || actionResourceId !== null}>
                        <Trash2 className="h-4 w-4" />
                        <span className="ml-2">Archive ({selectedActiveIds.length})</span>
                      </Button>
                      <Button size="sm" onClick={() => void restoreSelected()}
                        disabled={selectedArchivedIds.length === 0 || isBulkActing || actionResourceId !== null}>
                        <ArchiveRestore className="h-4 w-4" />
                        <span className="ml-2">Restore ({selectedArchivedIds.length})</span>
                      </Button>
                    </div>
                  </div>

                  {isLoading ? (
                    <p className="p-6 text-sm text-muted-foreground">Loading resources…</p>
                  ) : filteredResources.length === 0 ? (
                    <p className="p-6 text-sm text-muted-foreground">No resources match the current filters.</p>
                  ) : (
                    <>
                      <div className="overflow-auto">
                        <Table>
                          <TableHeader className="sticky top-0 z-10 bg-card">
                            <TableRow>
                              <TableHead className="w-10 bg-card">
                                <Checkbox checked={pageSelectState}
                                  onCheckedChange={(c) => togglePageSelection(c === true)}
                                  disabled={isBulkActing || actionResourceId !== null} />
                              </TableHead>
                              <TableHead className="w-6 bg-card" />
                              <TableHead className="bg-card">Category</TableHead>
                              <TableHead className="w-20 bg-card">Status</TableHead>
                              <TableHead className="w-24 bg-card">Links</TableHead>
                              <TableHead className="w-20 bg-card">Tags</TableHead>
                              <TableHead className="w-36 bg-card">Created</TableHead>
                              <TableHead className="w-36 bg-card">Archived</TableHead>
                              <TableHead className="w-28 bg-card">Resource ID</TableHead>
                              <TableHead className="w-28 bg-card">Workspace</TableHead>
                              <TableHead className="w-28 bg-card">Owner</TableHead>
                              <TableHead className="w-36 bg-card text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {pagedResources.map((resource) => {
                              const archived = isArchived(resource)
                              const isBusy = actionResourceId !== null || isBulkActing
                              const isExpanded = expandedResourceIds.has(resource.id)

                              return (
                                <>
                                  <TableRow
                                    key={resource.id}
                                    className={`cursor-pointer ${archived ? "opacity-75" : ""}`}
                                    onClick={() => toggleExpanded(resource.id)}
                                  >
                                    <TableCell onClick={(e) => e.stopPropagation()}>
                                      <Checkbox
                                        checked={selectedIdSet.has(resource.id)}
                                        onCheckedChange={(c) => toggleResourceSelection(resource.id, c === true)}
                                        disabled={isBusy}
                                      />
                                    </TableCell>
                                    <TableCell className="text-muted-foreground/50">
                                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                                    </TableCell>
                                    <TableCell>
                                      <span className="font-medium">{resource.category}</span>
                                    </TableCell>
                                    <TableCell>
                                      {archived
                                        ? <Badge variant="outline">archived</Badge>
                                        : <Badge variant="secondary">active</Badge>}
                                    </TableCell>
                                    <TableCell className="font-mono text-xs">{resource.links.length}</TableCell>
                                    <TableCell className="font-mono text-xs">{resource.tags.length}</TableCell>
                                    <TableCell className="text-xs text-muted-foreground">{formatTs(resource.createdAt)}</TableCell>
                                    <TableCell className="text-xs text-muted-foreground">{formatTs(resource.deletedAt)}</TableCell>
                                    <TableCell onClick={(e) => e.stopPropagation()}>
                                      <UuidCell value={resource.id} />
                                    </TableCell>
                                    <TableCell onClick={(e) => e.stopPropagation()}>
                                      <UuidCell value={resource.workspaceId} />
                                    </TableCell>
                                    <TableCell onClick={(e) => e.stopPropagation()}>
                                      <UuidCell value={resource.ownerUserId} />
                                    </TableCell>
                                    <TableCell onClick={(e) => e.stopPropagation()}>
                                      <div className="flex justify-end">
                                        {archived ? (
                                          <Button size="sm" onClick={() => void restoreResource(resource.id)} disabled={isBusy}>
                                            <ArchiveRestore className="h-3.5 w-3.5" />
                                            <span className="ml-1.5">{isBusy ? "…" : "Restore"}</span>
                                          </Button>
                                        ) : (
                                          <Button size="sm" variant="destructive" onClick={() => void archiveResource(resource.id)} disabled={isBusy}>
                                            <Trash2 className="h-3.5 w-3.5" />
                                            <span className="ml-1.5">{isBusy ? "…" : "Archive"}</span>
                                          </Button>
                                        )}
                                      </div>
                                    </TableCell>
                                  </TableRow>

                                  {isExpanded && (
                                    <TableRow key={`${resource.id}-detail`} className="bg-secondary/20 hover:bg-secondary/20">
                                      <TableCell />
                                      <TableCell colSpan={11} className="py-3">
                                        <div className="space-y-3">
                                          {/* Tags */}
                                          {resource.tags.length > 0 && (
                                            <div className="flex flex-wrap items-center gap-1.5">
                                              <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                              {resource.tags.map((tag) => (
                                                <Badge key={tag} variant="outline" className="text-[11px]">{tag}</Badge>
                                              ))}
                                            </div>
                                          )}

                                          {/* Links */}
                                          {resource.links.length > 0 && (
                                            <div className="space-y-1.5">
                                              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                                Links ({resource.links.length})
                                              </p>
                                              <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                                                {resource.links.map((link) => (
                                                  <div key={link.id} className="rounded-md border border-border/60 bg-card p-2 text-xs">
                                                    <div className="flex items-start justify-between gap-2">
                                                      <span className="font-medium text-foreground">{link.label}</span>
                                                      <button
                                                        type="button"
                                                        className="shrink-0 text-muted-foreground/50 hover:text-muted-foreground"
                                                        onClick={() => void copyToClipboard(link.url)}
                                                      >
                                                        <ClipboardCopy className="h-3 w-3" />
                                                      </button>
                                                    </div>
                                                    <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">{link.url}</p>
                                                    {link.note && (
                                                      <p className="mt-1 text-[11px] text-muted-foreground/80 italic">{link.note}</p>
                                                    )}
                                                    <p className="mt-1 font-mono text-[10px] text-muted-foreground/50">id: {link.id}</p>
                                                  </div>
                                                ))}
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  )}
                                </>
                              )
                            })}
                          </TableBody>
                        </Table>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
                        <p className="text-xs text-muted-foreground">
                          Showing {pageStartIndex}–{pageEndIndex} of {filteredResources.length}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v) as typeof pageSize)}>
                            <SelectTrigger className="h-8 w-[118px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {PAGE_SIZE_OPTIONS.map((n) => (
                                <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">Page {resourcePage} of {resourcePageCount}</p>
                          <Button size="icon" variant="outline" className="h-8 w-8"
                            onClick={() => setResourcePage((p) => p - 1)} disabled={resourcePage <= 1}>
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="outline" className="h-8 w-8"
                            onClick={() => setResourcePage((p) => p + 1)} disabled={resourcePage >= resourcePageCount}>
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* ── AUDIT LOG ────────────────────────────────────────────── */}
          {activeSection === "audit" && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Audit Log</h2>
                <p className="text-sm text-muted-foreground">Archive and restore operations with full actor attribution.</p>
              </div>

              <Card className="overflow-hidden">
                <CardContent className="space-y-0 p-0">
                  {auditError ? (
                    <div className="flex items-center justify-between gap-3 p-4">
                      <p className="text-sm text-muted-foreground">{auditError}</p>
                      <Button size="sm" variant="outline" onClick={() => void fetchAuditLogs()} disabled={isAuditLoading}>Retry</Button>
                    </div>
                  ) : isAuditLoading ? (
                    <p className="p-6 text-sm text-muted-foreground">Loading audit log…</p>
                  ) : auditLogs.length === 0 ? (
                    <p className="p-6 text-sm text-muted-foreground">No audit events yet.</p>
                  ) : (
                    <>
                      <div className="overflow-auto">
                        <Table>
                          <TableHeader className="sticky top-0 z-10 bg-card">
                            <TableRow>
                              <TableHead className="w-48 bg-card">When</TableHead>
                              <TableHead className="w-28 bg-card">Action</TableHead>
                              <TableHead className="bg-card">Resource</TableHead>
                              <TableHead className="w-28 bg-card">Resource ID</TableHead>
                              <TableHead className="w-52 bg-card">Actor</TableHead>
                              <TableHead className="w-28 bg-card">Actor ID</TableHead>
                              <TableHead className="w-28 bg-card">Log ID</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {pagedAuditLogs.map((log) => (
                              <TableRow key={log.id}>
                                <TableCell className="text-xs text-muted-foreground">{formatTs(log.createdAt)}</TableCell>
                                <TableCell>
                                  {log.action === "archived" ? (
                                    <Badge variant="destructive">archived</Badge>
                                  ) : (
                                    <Badge variant="secondary">restored</Badge>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <span className="font-medium">{log.resourceCategory}</span>
                                </TableCell>
                                <TableCell><UuidCell value={log.resourceId} /></TableCell>
                                <TableCell className="text-xs text-muted-foreground">{log.actorIdentifier}</TableCell>
                                <TableCell><UuidCell value={log.actorUserId} /></TableCell>
                                <TableCell><UuidCell value={log.id} /></TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
                        <p className="text-xs text-muted-foreground">
                          Showing {auditStartIndex}–{auditEndIndex} of {auditLogs.length}
                        </p>
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-muted-foreground">Page {auditPage} of {auditPageCount}</p>
                          <Button size="icon" variant="outline" className="h-8 w-8"
                            onClick={() => setAuditPage((p) => p - 1)} disabled={auditPage <= 1}>
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="outline" className="h-8 w-8"
                            onClick={() => setAuditPage((p) => p + 1)} disabled={auditPage >= auditPageCount}>
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

        </main>
      </div>

      <Toaster position="bottom-right" theme="dark" />
    </div>
  )
}
