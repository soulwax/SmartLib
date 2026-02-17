import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { canCreateResources, deriveUserRole } from "@/lib/authorization"
import {
  ResourceNotFoundError,
  ResourceWorkspaceNotFoundError,
} from "@/lib/resource-repository"
import {
  createResourceService,
  listResourcesService,
} from "@/lib/resource-service"
import { parseResourceInput } from "@/lib/resource-validation"

export const runtime = "nodejs"

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function handleRouteError(error: unknown) {
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

export async function GET() {
  try {
    const session = await auth()
    const { mode, resources } = await listResourcesService({
      userId: session?.user?.id ?? null,
    })
    return NextResponse.json({ mode, resources })
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function POST(request: Request) {
  try {
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
    })

    return NextResponse.json({ mode, resource }, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
