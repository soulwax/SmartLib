import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { canCreateResources, deriveUserRole } from "@/lib/authorization"
import { CSRFValidationError, validateCSRF } from "@/lib/csrf-protection"
import {
  ResourceNotFoundError,
  ResourceWorkspaceNotFoundError,
} from "@/lib/resource-repository"
import {
  createResourceService,
  listResourcesPageService,
  listResourcesService,
} from "@/lib/resource-service"
import { parseResourceInput } from "@/lib/resource-validation"

export const runtime = "nodejs"

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function handleRouteError(error: unknown) {
  if (error instanceof CSRFValidationError) {
    return errorResponse("Invalid request origin.", 403)
  }

  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: "Invalid request payload.",
        details: error.flatten(),
      },
      { status: 400 }
    )
  }

  if (error instanceof ResourceNotFoundError) {
    return errorResponse(error.message, 404)
  }

  if (error instanceof ResourceWorkspaceNotFoundError) {
    return errorResponse(error.message, 404)
  }

  return errorResponse("Unexpected server error.", 500)
}

async function readRequestJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new z.ZodError([
      {
        code: "custom",
        path: [],
        message: "Request body must be valid JSON.",
      },
    ])
  }
}

function parseOptionalQueryInt(
  value: string | null,
  fieldName: string,
): number | undefined {
  if (value === null || value.trim().length === 0) {
    return undefined
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new z.ZodError([
      {
        code: "custom",
        path: [fieldName],
        message: `${fieldName} must be a non-negative integer.`,
      },
    ])
  }

  return parsed
}

export async function GET(request: Request) {
  try {
    const session = await auth()
    const url = new URL(request.url)
    const workspaceId = url.searchParams.get("workspaceId")?.trim() || null
    const offset = parseOptionalQueryInt(url.searchParams.get("offset"), "offset")
    const limit = parseOptionalQueryInt(url.searchParams.get("limit"), "limit")
    const paginationRequested =
      typeof offset === "number" || typeof limit === "number"
    const options = {
      userId: session?.user?.id ?? null,
      workspaceId,
      includeAllWorkspaces: session?.user?.isFirstAdmin === true,
    }

    if (paginationRequested) {
      const { mode, resources, nextOffset } = await listResourcesPageService({
        ...options,
        offset,
        limit,
      })
      return NextResponse.json({ mode, resources, nextOffset })
    }

    const { mode, resources } = await listResourcesService(options)
    return NextResponse.json({ mode, resources, nextOffset: null })
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function POST(request: Request) {
  try {
    validateCSRF(request)

    const session = await auth()
    if (!session?.user?.id) {
      return errorResponse("Authentication required.", 401)
    }

    const role = deriveUserRole({
      role: session.user.role,
      isAdmin: session.user.isAdmin,
      isFirstAdmin: session.user.isFirstAdmin,
    })
    if (!canCreateResources(role)) {
      return errorResponse("Insufficient permissions for creating resources.", 403)
    }

    const payload = await readRequestJson(request)
    const input = parseResourceInput(payload)
    const { mode, resource } = await createResourceService(input, {
      ownerUserId: session.user.id,
      includeAllWorkspaces: session.user.isFirstAdmin === true,
    })

    return NextResponse.json({ mode, resource }, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
