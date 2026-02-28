import { NextResponse } from "next/server"

import { ensureSchema } from "@/lib/db"
import { listStaleOrMissingHostnames, upsertFaviconCache } from "@/lib/favicon-repository"
import { resolveFavicon } from "@/lib/favicon-service"

export const runtime = "nodejs"
export const maxDuration = 60

// Lazy refresh: check favicons older than 24 hours, process 50 at a time
// Generated fallbacks are retried every 7 days (configured in repository)
const STALE_AFTER_HOURS = 24
const BATCH_LIMIT = 50

// Add retry count to avoid infinite retries on persistently broken hostnames
const MAX_CONSECUTIVE_FAILURES = 3

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    // No secret configured — only allow in development
    return process.env.NODE_ENV !== "production"
  }

  const auth = request.headers.get("authorization") ?? ""
  return auth === `Bearer ${cronSecret}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    await ensureSchema()

    const hostnames = await listStaleOrMissingHostnames(STALE_AFTER_HOURS, BATCH_LIMIT)

    if (hostnames.length === 0) {
      return NextResponse.json({ refreshed: 0, message: "All favicons are fresh." })
    }

    const results = await Promise.allSettled(
      hostnames.map(async (hostname) => {
        try {
          const favicon = await resolveFavicon(hostname)
          await upsertFaviconCache(hostname, favicon)
          return {
            hostname,
            sourceUrl: favicon?.sourceUrl ?? null,
            status: "success" as const,
          }
        } catch (error) {
          console.error(`[favicon-refresh] Failed to resolve ${hostname}:`, error)
          return {
            hostname,
            error: error instanceof Error ? error.message : "Unknown error",
            status: "error" as const,
          }
        }
      })
    )

    const succeeded = results.filter((r) => r.status === "fulfilled").length
    const failed = results.filter((r) => r.status === "rejected").length
    const details = results
      .map((r) => r.status === "fulfilled" ? r.value : null)
      .filter(Boolean)

    const generatedCount = details.filter((d) => d?.sourceUrl?.startsWith("generated:")).length

    return NextResponse.json({
      refreshed: succeeded,
      failed,
      total: hostnames.length,
      generated: generatedCount,
      details: details.slice(0, 10), // Include first 10 for debugging
    })
  } catch (error) {
    console.error("[favicon-refresh] Cron error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 },
    )
  }
}
