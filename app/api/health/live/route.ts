import { NextResponse } from "next/server"

export const runtime = "nodejs"

function getAppVersion(): string | null {
  const fromEnv = process.env.APP_VERSION?.trim()
  if (fromEnv) {
    return fromEnv
  }

  return process.env.npm_package_version?.trim() ?? null
}

export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      version: getAppVersion(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  )
}
