import { sql } from "drizzle-orm"
import { NextResponse } from "next/server"

import { getDb } from "@/lib/db"
import { hasDatabaseEnv } from "@/lib/env"
import { getRateLimitBackendHealth } from "@/lib/rate-limit"

export const runtime = "nodejs"

const HEALTH_CHECK_TIMEOUT_MS = 3000

type ComponentStatus = "up" | "down" | "degraded" | "disabled"

interface ComponentHealth {
  status: ComponentStatus
  message: string
  latencyMs?: number
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(timeoutMessage))
    }, timeoutMs)
    ;(timeout as NodeJS.Timeout).unref?.()

    promise
      .then((result) => {
        clearTimeout(timeout)
        resolve(result)
      })
      .catch((error) => {
        clearTimeout(timeout)
        reject(error)
      })
  })
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function checkDatabaseHealth(): Promise<ComponentHealth> {
  if (!hasDatabaseEnv()) {
    return {
      status: "disabled",
      message: "Database environment variables are not configured (mock mode).",
    }
  }

  const startedAt = Date.now()
  try {
    await withTimeout(
      getDb().execute(sql`SELECT 1 AS ok`),
      HEALTH_CHECK_TIMEOUT_MS,
      "Database health check timed out"
    )
    return {
      status: "up",
      message: "Database reachable.",
      latencyMs: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      status: "down",
      message: `Database health check failed: ${formatErrorMessage(error)}`,
      latencyMs: Date.now() - startedAt,
    }
  }
}

async function checkRateLimitHealth(): Promise<ComponentHealth> {
  const health = await getRateLimitBackendHealth()

  if (health.source === "redis" && health.healthy) {
    return {
      status: "up",
      message: health.message,
    }
  }

  if (!health.configured) {
    return {
      status: "disabled",
      message: health.message,
    }
  }

  return {
    status: "degraded",
    message: health.message,
  }
}

export async function GET() {
  const [database, rateLimit] = await Promise.all([
    checkDatabaseHealth(),
    checkRateLimitHealth(),
  ])

  const hasHardFailure = database.status === "down"
  const hasDegraded =
    database.status === "degraded" || rateLimit.status === "degraded"
  const status = hasHardFailure ? "down" : hasDegraded ? "degraded" : "ok"

  return NextResponse.json(
    {
      status,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      components: {
        database,
        rateLimit,
      },
    },
    {
      status: hasHardFailure ? 503 : 200,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  )
}
