import "server-only"

import { asc, desc, isNull, lte, or } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { faviconCache, resourceLinks } from "@/lib/db-schema"
import { FAVICON_REVALIDATE_INTERVAL_HOURS } from "@/lib/favicon-repository"
import { hostnameFromUrl } from "@/lib/favicon-service"

const DEFAULT_ENTRY_LIMIT = 8
const RECENT_CHECK_WINDOW_MS =
  FAVICON_REVALIDATE_INTERVAL_HOURS * 60 * 60 * 1000
const RECENT_CHANGE_WINDOW_MS = 24 * 60 * 60 * 1000

export interface FaviconAdminEntry {
  hostname: string
  sourceUrl: string | null
  sourceKind: "site" | "google" | "generated" | "unknown"
  hasStoredImage: boolean
  hasValidators: boolean
  lastCheckedAt: string | null
  lastChangedAt: string | null
  nextCheckAt: string | null
}

export interface FaviconAdminStats {
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

export interface FaviconAdminSnapshot {
  revalidateAfterHours: number
  stats: FaviconAdminStats
  dueEntries: FaviconAdminEntry[]
  recentChecks: FaviconAdminEntry[]
}

type FaviconCacheRow = {
  hostname: string
  faviconUrl: string | null
  faviconContentType: string | null
  faviconBase64: string | null
  fetchEtag: string | null
  fetchLastModified: string | null
  lastCheckedAt: Date | string
  lastChangedAt: Date | string
  nextCheckAt: Date | string | null
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

function toTimestamp(value: Date | string | null | undefined): number {
  if (!value) {
    return -1
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? -1 : value.getTime()
  }

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? -1 : parsed
}

function sourceKindFromUrl(sourceUrl: string | null): FaviconAdminEntry["sourceKind"] {
  if (!sourceUrl) {
    return "unknown"
  }

  if (sourceUrl.startsWith("generated:")) {
    return "generated"
  }

  if (sourceUrl.includes("google.com/s2/favicons")) {
    return "google"
  }

  if (sourceUrl.startsWith("http://") || sourceUrl.startsWith("https://")) {
    return "site"
  }

  return "unknown"
}

function mapEntry(row: FaviconCacheRow): FaviconAdminEntry {
  return {
    hostname: row.hostname,
    sourceUrl: row.faviconUrl ?? null,
    sourceKind: sourceKindFromUrl(row.faviconUrl ?? null),
    hasStoredImage: Boolean(row.faviconBase64 && row.faviconContentType),
    hasValidators: Boolean(row.fetchEtag || row.fetchLastModified),
    lastCheckedAt: toIsoString(row.lastCheckedAt),
    lastChangedAt: toIsoString(row.lastChangedAt),
    nextCheckAt: toIsoString(row.nextCheckAt),
  }
}

export async function getFaviconAdminSnapshot(
  limit = DEFAULT_ENTRY_LIMIT
): Promise<FaviconAdminSnapshot> {
  const db = getDb()
  const now = Date.now()
  const recentCheckThreshold = now - RECENT_CHECK_WINDOW_MS
  const recentChangeThreshold = now - RECENT_CHANGE_WINDOW_MS

  const baseSelect = {
    hostname: faviconCache.hostname,
    faviconUrl: faviconCache.faviconUrl,
    faviconContentType: faviconCache.faviconContentType,
    faviconBase64: faviconCache.faviconBase64,
    fetchEtag: faviconCache.fetchEtag,
    fetchLastModified: faviconCache.fetchLastModified,
    lastCheckedAt: faviconCache.lastCheckedAt,
    lastChangedAt: faviconCache.lastChangedAt,
    nextCheckAt: faviconCache.nextCheckAt,
  }

  const [cacheRows, linkRows, dueRows, recentChecksRows] = await Promise.all([
    db.select(baseSelect).from(faviconCache),
    db.selectDistinct({ url: resourceLinks.url }).from(resourceLinks),
    db
      .select(baseSelect)
      .from(faviconCache)
      .where(
        or(isNull(faviconCache.nextCheckAt), lte(faviconCache.nextCheckAt, new Date()))
      )
      .orderBy(asc(faviconCache.nextCheckAt), asc(faviconCache.lastCheckedAt))
      .limit(limit),
    db
      .select(baseSelect)
      .from(faviconCache)
      .orderBy(desc(faviconCache.lastCheckedAt))
      .limit(limit),
  ])

  const trackedHostnames = new Set<string>()
  for (const row of linkRows) {
    const hostname = hostnameFromUrl(row.url)
    if (hostname) {
      trackedHostnames.add(hostname)
    }
  }

  const cachedHostnames = new Set(cacheRows.map((row) => row.hostname))
  const trackedCachedHostnames = [...trackedHostnames].filter((hostname) =>
    cachedHostnames.has(hostname)
  ).length
  const dueNowCount = cacheRows.filter((row) => {
    const nextCheckAt = toTimestamp(row.nextCheckAt)
    return nextCheckAt === -1 || nextCheckAt <= now
  }).length
  const storedPayloadCount = cacheRows.filter(
    (row) => Boolean(row.faviconBase64 && row.faviconContentType)
  ).length
  const generatedFallbackCount = cacheRows.filter((row) =>
    row.faviconUrl?.startsWith("generated:")
  ).length
  const validatorBackedCount = cacheRows.filter(
    (row) => Boolean(row.fetchEtag || row.fetchLastModified)
  ).length
  const checkedLastWindowCount = cacheRows.filter(
    (row) => toTimestamp(row.lastCheckedAt) >= recentCheckThreshold
  ).length
  const changedLast24HoursCount = cacheRows.filter(
    (row) => toTimestamp(row.lastChangedAt) >= recentChangeThreshold
  ).length
  const lastCheckedAt =
    cacheRows.length === 0
      ? null
      : toIsoString(
          [...cacheRows]
            .sort((left, right) => toTimestamp(right.lastCheckedAt) - toTimestamp(left.lastCheckedAt))[0]
            ?.lastCheckedAt
        )

  const trackedHostnameCount = trackedHostnames.size
  const cachedHostnameCount = trackedCachedHostnames
  const coveragePercent =
    trackedHostnameCount === 0
      ? 0
      : Math.round((cachedHostnameCount / trackedHostnameCount) * 100)

  return {
    revalidateAfterHours: FAVICON_REVALIDATE_INTERVAL_HOURS,
    stats: {
      trackedHostnames: trackedHostnameCount,
      cachedHostnames: cachedHostnameCount,
      uncachedHostnames: Math.max(0, trackedHostnameCount - cachedHostnameCount),
      coveragePercent,
      dueNowCount,
      storedPayloadCount,
      generatedFallbackCount,
      validatorBackedCount,
      checkedLastWindowCount,
      changedLast24HoursCount,
      lastCheckedAt,
    },
    dueEntries: dueRows.map(mapEntry),
    recentChecks: recentChecksRows.map(mapEntry),
  }
}
