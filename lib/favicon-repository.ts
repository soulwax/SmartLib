import "server-only"

import { asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { faviconCache, resourceLinks } from "@/lib/db-schema"
import type { ResolvedFaviconPayload } from "@/lib/favicon-service"

export const FAVICON_REVALIDATE_INTERVAL_HOURS = 8
const FAVICON_REVALIDATE_INTERVAL_MS =
  FAVICON_REVALIDATE_INTERVAL_HOURS * 60 * 60 * 1000

export interface FaviconCacheEntry {
  hostname: string
  faviconUrl: string | null
  faviconContentType: string | null
  faviconBase64: string | null
  faviconHash: string | null
  fetchEtag: string | null
  fetchLastModified: string | null
  lastCheckedAt: Date | string
  lastChangedAt: Date | string
  nextCheckAt: Date | string | null
}

function buildDataUri(
  contentType: string | null,
  contentBase64: string | null
): string | null {
  if (!contentType || !contentBase64) {
    return null
  }

  return `data:${contentType};base64,${contentBase64}`
}

function buildNextCheckAt(base = new Date()): Date {
  return new Date(base.getTime() + FAVICON_REVALIDATE_INTERVAL_MS)
}

/**
 * Batch-fetch cached favicons for the given hostnames.
 * Returns a data URI when image bytes are stored in the database.
 * Falls back to the legacy cached URL if image bytes are not available yet.
 * Hostnames not present in the cache are omitted from the result map.
 */
export async function getFaviconUrlsByHostnames(
  hostnames: string[]
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>()
  if (hostnames.length === 0) return result

  const db = getDb()
  const rows = await db
    .select({
      hostname: faviconCache.hostname,
      faviconUrl: faviconCache.faviconUrl,
      faviconContentType: faviconCache.faviconContentType,
      faviconBase64: faviconCache.faviconBase64,
    })
    .from(faviconCache)
    .where(inArray(faviconCache.hostname, hostnames))

  for (const row of rows) {
    const dataUri = buildDataUri(
      row.faviconContentType ?? null,
      row.faviconBase64 ?? null
    )
    result.set(row.hostname, dataUri ?? row.faviconUrl ?? null)
  }

  return result
}

/**
 * Insert or update a favicon cache entry for the given hostname.
 * `lastChangedAt` is only updated when the favicon content hash changes.
 */
export async function upsertFaviconCache(
  hostname: string,
  favicon: ResolvedFaviconPayload | null
): Promise<void> {
  const db = getDb()
  const now = new Date()
  const faviconUrl = favicon?.sourceUrl ?? null
  const faviconContentType = favicon?.contentType ?? null
  const faviconBase64 = favicon?.contentBase64 ?? null
  const faviconHash = favicon?.contentHash ?? null
  const fetchEtag = favicon?.etag ?? null
  const fetchLastModified = favicon?.lastModified ?? null

  await db
    .insert(faviconCache)
    .values({
      hostname,
      faviconUrl,
      faviconContentType,
      faviconBase64,
      faviconHash,
      fetchEtag,
      fetchLastModified,
      lastCheckedAt: now,
      lastChangedAt: now,
      nextCheckAt: buildNextCheckAt(now),
    })
    .onConflictDoUpdate({
      target: faviconCache.hostname,
      set: {
        faviconUrl,
        faviconContentType,
        faviconBase64,
        faviconHash,
        fetchEtag,
        fetchLastModified,
        lastCheckedAt: now,
        nextCheckAt: buildNextCheckAt(now),
        // Only bump lastChangedAt when the image bytes changed.
        lastChangedAt: sql`
          CASE
            WHEN ${faviconCache.faviconHash} IS DISTINCT FROM EXCLUDED.favicon_hash
            THEN NOW()
            ELSE ${faviconCache.lastChangedAt}
          END
        `,
      },
    })
}

export async function markFaviconCacheChecked(
  hostname: string,
  state?: {
    sourceUrl?: string | null
    etag?: string | null
    lastModified?: string | null
  }
): Promise<void> {
  const db = getDb()
  const now = new Date()

  await db
    .update(faviconCache)
    .set({
      ...(state?.sourceUrl !== undefined ? { faviconUrl: state.sourceUrl } : {}),
      ...(state?.etag !== undefined ? { fetchEtag: state.etag } : {}),
      ...(state?.lastModified !== undefined
        ? { fetchLastModified: state.lastModified }
        : {}),
      lastCheckedAt: now,
      nextCheckAt: buildNextCheckAt(now),
    })
    .where(eq(faviconCache.hostname, hostname))
}

/**
 * Returns hostnames with missing persisted favicon image bytes.
 * This is used to backfill legacy URL-only cache entries.
 */
export async function listHostnamesMissingStoredFavicons(
  hostnames: string[]
): Promise<string[]> {
  if (hostnames.length === 0) {
    return []
  }

  const db = getDb()
  const rows = await db
    .select({
      hostname: faviconCache.hostname,
      faviconBase64: faviconCache.faviconBase64,
    })
    .from(faviconCache)
    .where(inArray(faviconCache.hostname, hostnames))

  const withStoredImage = new Set<string>()
  for (const row of rows) {
    if (row.faviconBase64) {
      withStoredImage.add(row.hostname)
    }
  }

  return hostnames.filter((hostname) => !withStoredImage.has(hostname))
}

export async function listDueFaviconCacheEntries(
  limit = 300
): Promise<FaviconCacheEntry[]> {
  const db = getDb()
  const now = new Date()

  return db
    .select({
      hostname: faviconCache.hostname,
      faviconUrl: faviconCache.faviconUrl,
      faviconContentType: faviconCache.faviconContentType,
      faviconBase64: faviconCache.faviconBase64,
      faviconHash: faviconCache.faviconHash,
      fetchEtag: faviconCache.fetchEtag,
      fetchLastModified: faviconCache.fetchLastModified,
      lastCheckedAt: faviconCache.lastCheckedAt,
      lastChangedAt: faviconCache.lastChangedAt,
      nextCheckAt: faviconCache.nextCheckAt,
    })
    .from(faviconCache)
    .where(
      or(isNull(faviconCache.nextCheckAt), lte(faviconCache.nextCheckAt, now))
    )
    .orderBy(asc(faviconCache.nextCheckAt), asc(faviconCache.lastCheckedAt))
    .limit(limit)
}

/**
 * Return hostnames derived from resource_links that do not yet have any entry
 * in favicon_cache. This backfills legacy rows that predate cache seeding.
 */
export async function listUncachedHostnames(limit = 300): Promise<string[]> {
  const db = getDb()

  const linkRows = await db.selectDistinct({ url: resourceLinks.url }).from(resourceLinks)

  const allHostnames = new Set<string>()
  for (const row of linkRows) {
    try {
      const hostname = new URL(row.url).hostname
      if (hostname) {
        allHostnames.add(hostname)
      }
    } catch {
      // skip malformed URLs
    }
  }

  if (allHostnames.size === 0) {
    return []
  }

  const hostnameList = [...allHostnames]
  const cacheRows = await db
    .select({ hostname: faviconCache.hostname })
    .from(faviconCache)
    .where(inArray(faviconCache.hostname, hostnameList))

  const cachedHostnames = new Set(cacheRows.map((row) => row.hostname))
  return hostnameList.filter((hostname) => !cachedHostnames.has(hostname)).slice(0, limit)
}
