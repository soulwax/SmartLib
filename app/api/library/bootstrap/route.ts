import { NextResponse } from "next/server"

import { auth } from "@/auth"
import { createApiErrorResponse } from "@/lib/api-error"
import {
  getLibraryBootstrapService,
} from "@/lib/resource-service"

export const runtime = "nodejs"

function parseOptionalQueryInt(
  value: string | null,
  fallback: number,
): number {
  const trimmed = value?.trim()
  if (!trimmed) {
    return fallback
  }

  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback
  }

  return parsed
}

export async function GET(request: Request) {
  try {
    const session = await auth()
    const url = new URL(request.url)
    const requestedOrganizationId =
      url.searchParams.get("organizationId")?.trim() || null
    const requestedWorkspaceId =
      url.searchParams.get("workspaceId")?.trim() || null
    const limit = parseOptionalQueryInt(url.searchParams.get("limit"), 200)
    const options = {
      userId: session?.user?.id ?? null,
      includeAllWorkspaces: session?.user?.isFirstAdmin === true,
    }

    const result = await getLibraryBootstrapService({
      ...options,
      organizationId: requestedOrganizationId,
      workspaceId: requestedWorkspaceId,
      offset: 0,
      limit,
    })

    return NextResponse.json({
      mode: result.mode,
      organizationId: result.organizationId,
      workspaceId: result.workspaceId,
      resources: result.resources,
      nextOffset: result.nextOffset,
      categories: result.categories,
      organizations: result.organizations,
      workspaces: result.workspaces,
      workspaceCounts: result.workspaceCounts,
    })
  } catch {
    return createApiErrorResponse({
      message: "Unexpected server error.",
      status: 500,
    })
  }
}
