import { NextResponse } from "next/server"

import { ensureSchema } from "@/lib/db"
import { listStaleOrMissingHostnames, upsertFaviconCache } from "@/lib/favicon-repository"
import { resolveFaviconUrl } from "@/lib/favicon-service"

export const runtime = "nodejs"
export const maxDuration = 60

const STALE_AFTER_HOURS = 8
const BATCH_LIMIT = 300

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
        const faviconUrl = await resolveFaviconUrl(hostname)
        await upsertFaviconCache(hostname, faviconUrl)
        return { hostname, faviconUrl }
      })
    )

    const succeeded = results.filter((r) => r.status === "fulfilled").length
    const failed = results.filter((r) => r.status === "rejected").length

    return NextResponse.json({
      refreshed: succeeded,
      failed,
      total: hostnames.length,
    })
  } catch (error) {
    console.error("[favicon-refresh] Cron error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 },
    )
  }
}
