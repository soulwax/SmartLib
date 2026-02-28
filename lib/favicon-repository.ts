import "server-only"

import { inArray, sql } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { faviconCache, resourceLinks } from "@/lib/db-schema"
import type { ResolvedFaviconPayload } from "@/lib/favicon-service"

function buildDataUri(
  contentType: string | null,
  contentBase64: string | null
): string | null {
  if (!contentType || !contentBase64) {
    return null
  }

  return `data:${contentType};base64,${contentBase64}`
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

  await db
    .insert(faviconCache)
    .values({
      hostname,
      faviconUrl,
      faviconContentType,
      faviconBase64,
      faviconHash,
      lastCheckedAt: now,
      lastChangedAt: now,
    })
    .onConflictDoUpdate({
      target: faviconCache.hostname,
      set: {
        faviconUrl,
        faviconContentType,
        faviconBase64,
        faviconHash,
        lastCheckedAt: now,
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

/**
 * Return hostnames derived from resource_links that either:
 *   - have no entry in favicon_cache yet, OR
 *   - were last checked more than `staleAfterHours` hours ago.
 *   - or do not yet have a persisted favicon image payload.
 *   - or have a generated fallback but should retry real favicons every 7 days.
 *
 * Hostname extraction is done in TypeScript to avoid complex SQL parsing.
 */
export async function listStaleOrMissingHostnames(
  staleAfterHours: number,
  limit = 300
): Promise<string[]> {
  const db = getDb()
  const threshold = new Date(Date.now() - staleAfterHours * 60 * 60 * 1000)
  const generatedRetryThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 days

  // All distinct link URLs
  const linkRows = await db.selectDistinct({ url: resourceLinks.url }).from(resourceLinks)

  // Extract unique hostnames in TypeScript
  const allHostnames = new Set<string>()
  for (const row of linkRows) {
    try {
      const hostname = new URL(row.url).hostname
      if (hostname) allHostnames.add(hostname)
    } catch {
      // skip malformed URLs
    }
  }

  if (allHostnames.size === 0) return []

  const hostnameList = [...allHostnames]

  // Find which are already fresh in the cache
  const cacheRows = await db
    .select({
      hostname: faviconCache.hostname,
      lastCheckedAt: faviconCache.lastCheckedAt,
      faviconBase64: faviconCache.faviconBase64,
      faviconUrl: faviconCache.faviconUrl,
    })
    .from(faviconCache)
    .where(inArray(faviconCache.hostname, hostnameList))

  const freshSet = new Set<string>()
  for (const row of cacheRows) {
    const checkedAt =
      row.lastCheckedAt instanceof Date
        ? row.lastCheckedAt
        : new Date(row.lastCheckedAt)

    const hasImageData = !!row.faviconBase64
    const isGenerated = row.faviconUrl?.startsWith("generated:")

    // Fresh if:
    // - Has image data AND checked recently
    // - OR is not generated and checked within normal threshold
    // Generated favicons should be retried for real favicons less frequently
    if (hasImageData && checkedAt >= threshold) {
      freshSet.add(row.hostname)
    } else if (isGenerated && checkedAt >= generatedRetryThreshold) {
      // Don't retry generated favicons too often
      freshSet.add(row.hostname)
    }
  }

  return hostnameList.filter((h) => !freshSet.has(h)).slice(0, limit)
}
