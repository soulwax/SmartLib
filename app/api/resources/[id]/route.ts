import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { ResourceNotFoundError } from "@/lib/resource-repository"
import {
  deleteResourceService,
  updateResourceService,
} from "@/lib/resource-service"
import { parseResourceInput } from "@/lib/resource-validation"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

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

async function parseResourceId(context: RouteContext) {
  const params = await Promise.resolve(context.params)
  return z.string().uuid().parse(params.id)
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return errorResponse("Authentication required.", 401)
    }

    const resourceId = await parseResourceId(context)
    const payload = await readRequestJson(request)
    const input = parseResourceInput(payload)
    const { mode, resource } = await updateResourceService(resourceId, input)

    return NextResponse.json({ mode, resource })
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return errorResponse("Authentication required.", 401)
    }

    const resourceId = await parseResourceId(context)
    const { mode } = await deleteResourceService(resourceId)

    return NextResponse.json({ mode, ok: true })
  } catch (error) {
    return handleRouteError(error)
  }
}
