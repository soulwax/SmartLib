import { timingSafeEqual } from "node:crypto"

import { NextResponse } from "next/server"

import { createApiErrorResponse } from "@/lib/api-error"
import { ensureSchema } from "@/lib/db"
import {
  FAVICON_REVALIDATE_INTERVAL_HOURS,
  listDueFaviconCacheEntries,
  listUncachedHostnames,
  markFaviconCacheChecked,
  upsertFaviconCache,
} from "@/lib/favicon-repository"
import { resolveFavicon, revalidateFavicon } from "@/lib/favicon-service"

export const runtime = "nodejs"
export const maxDuration = 60

const REVALIDATE_BATCH_LIMIT = 50
const UNCACHED_BATCH_LIMIT = 25

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    // No secret configured — only allow in development
    return process.env.NODE_ENV !== "production"
  }

  const auth = request.headers.get("authorization") ?? ""
  const expected = `Bearer ${cronSecret}`
  const receivedBuffer = Buffer.from(auth)
  const expectedBuffer = Buffer.from(expected)

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false
  }

  return timingSafeEqual(receivedBuffer, expectedBuffer)
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return createApiErrorResponse({
      message: "Unauthorized",
      status: 401,
    })
  }

  try {
    await ensureSchema()

    const dueEntries = await listDueFaviconCacheEntries(REVALIDATE_BATCH_LIMIT)
    const uncachedHostnames =
      dueEntries.length < REVALIDATE_BATCH_LIMIT
        ? await listUncachedHostnames(UNCACHED_BATCH_LIMIT)
        : []

    if (dueEntries.length === 0 && uncachedHostnames.length === 0) {
      return NextResponse.json({
        refreshed: 0,
        message: "All favicons are fresh.",
        revalidateAfterHours: FAVICON_REVALIDATE_INTERVAL_HOURS,
      })
    }

    const revalidationResults = await Promise.allSettled(
      dueEntries.map(async (entry) => {
        try {
          const result = await revalidateFavicon(entry.hostname, {
            sourceUrl: entry.faviconUrl,
            etag: entry.fetchEtag,
            lastModified: entry.fetchLastModified,
          })

          if (!result) {
            await markFaviconCacheChecked(entry.hostname)
            return {
              hostname: entry.hostname,
              sourceUrl: entry.faviconUrl,
              status: "deferred" as const,
              changed: false,
            }
          }

          if (result.status === "not-modified") {
            await markFaviconCacheChecked(entry.hostname, {
              sourceUrl: result.sourceUrl,
              etag: result.etag,
              lastModified: result.lastModified,
            })
            return {
              hostname: entry.hostname,
              sourceUrl: result.sourceUrl,
              status: "not-modified" as const,
              changed: false,
            }
          }

          await upsertFaviconCache(entry.hostname, result.favicon)
          return {
            hostname: entry.hostname,
            sourceUrl: result.favicon.sourceUrl,
            status: "updated" as const,
            changed: result.favicon.contentHash !== entry.faviconHash,
          }
        } catch (error) {
          console.error(
            `[favicon-refresh] Failed to revalidate ${entry.hostname}:`,
            error
          )
          await markFaviconCacheChecked(entry.hostname)
          return {
            hostname: entry.hostname,
            error: error instanceof Error ? error.message : "Unknown error",
            status: "error" as const,
          }
        }
      })
    )

    const seedResults = await Promise.allSettled(
      uncachedHostnames.map(async (hostname) => {
        try {
          const favicon = await resolveFavicon(hostname)
          await upsertFaviconCache(hostname, favicon)
          return {
            hostname,
            sourceUrl: favicon?.sourceUrl ?? null,
            status: "seeded" as const,
          }
        } catch (error) {
          console.error(`[favicon-refresh] Failed to seed ${hostname}:`, error)
          return {
            hostname,
            error: error instanceof Error ? error.message : "Unknown error",
            status: "error" as const,
          }
        }
      })
    )

    const results = [...revalidationResults, ...seedResults]
    const completed = results
      .map((r) => r.status === "fulfilled" ? r.value : null)
      .filter(Boolean)

    const failed = results.filter((r) => r.status === "rejected").length
    const generatedCount = completed.filter((d) => d?.sourceUrl?.startsWith("generated:")).length
    const updatedCount = completed.filter((d) => d?.status === "updated").length
    const notModifiedCount = completed.filter((d) => d?.status === "not-modified").length
    const seededCount = completed.filter((d) => d?.status === "seeded").length

    return NextResponse.json({
      refreshed: completed.length,
      failed,
      total: dueEntries.length + uncachedHostnames.length,
      revalidated: dueEntries.length,
      updated: updatedCount,
      notModified: notModifiedCount,
      seeded: seededCount,
      generated: generatedCount,
      revalidateAfterHours: FAVICON_REVALIDATE_INTERVAL_HOURS,
      details: completed.slice(0, 10),
    })
  } catch (error) {
    console.error("[favicon-refresh] Cron error:", error)
    return createApiErrorResponse({
      message: error instanceof Error ? error.message : "Internal error",
      status: 500,
    })
  }
}
