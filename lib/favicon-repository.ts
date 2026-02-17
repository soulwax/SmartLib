import "server-only"

import { inArray, sql } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { faviconCache, resourceLinks } from "@/lib/db-schema"

/**
 * Batch-fetch cached favicon URLs for the given hostnames.
 * Hostnames not present in the cache are omitted from the result map.
 */
export async function getFaviconUrlsByHostnames(
  hostnames: string[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>()
  if (hostnames.length === 0) return result

  const db = getDb()
  const rows = await db
    .select({
      hostname: faviconCache.hostname,
      faviconUrl: faviconCache.faviconUrl,
    })
    .from(faviconCache)
    .where(inArray(faviconCache.hostname, hostnames))

  for (const row of rows) {
    result.set(row.hostname, row.faviconUrl ?? null)
  }

  return result
}

/**
 * Insert or update a favicon cache entry for the given hostname.
 * `lastChangedAt` is only updated when the favicon URL actually changes.
 */
export async function upsertFaviconCache(
  hostname: string,
  faviconUrl: string | null,
): Promise<void> {
  const db = getDb()
  const now = new Date()

  await db
    .insert(faviconCache)
    .values({
      hostname,
      faviconUrl,
      lastCheckedAt: now,
      lastChangedAt: now,
    })
    .onConflictDoUpdate({
      target: faviconCache.hostname,
      set: {
        faviconUrl,
        lastCheckedAt: now,
        // Only bump lastChangedAt when the URL actually changed
        lastChangedAt: sql`
          CASE
            WHEN ${faviconCache.faviconUrl} IS DISTINCT FROM EXCLUDED.favicon_url
            THEN NOW()
            ELSE ${faviconCache.lastChangedAt}
          END
        `,
      },
    })
}

/**
 * Return hostnames derived from resource_links that either:
 *   - have no entry in favicon_cache yet, OR
 *   - were last checked more than `staleAfterHours` hours ago.
 *
 * Hostname extraction is done in TypeScript to avoid complex SQL parsing.
 */
export async function listStaleOrMissingHostnames(
  staleAfterHours: number,
  limit = 300,
): Promise<string[]> {
  const db = getDb()
  const threshold = new Date(Date.now() - staleAfterHours * 60 * 60 * 1000)

  // All distinct link URLs
  const linkRows = await db
    .selectDistinct({ url: resourceLinks.url })
    .from(resourceLinks)

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
    })
    .from(faviconCache)
    .where(inArray(faviconCache.hostname, hostnameList))

  const freshSet = new Set<string>()
  for (const row of cacheRows) {
    const checkedAt =
      row.lastCheckedAt instanceof Date
        ? row.lastCheckedAt
        : new Date(row.lastCheckedAt)
    if (checkedAt >= threshold) {
      freshSet.add(row.hostname)
    }
  }

  return hostnameList.filter((h) => !freshSet.has(h)).slice(0, limit)
}
