import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { CSRFValidationError, validateCSRF } from "@/lib/csrf-protection"
import {
  ResourceWorkspaceAlreadyExistsError,
  ResourceWorkspaceNotFoundError,
} from "@/lib/resource-repository"
import {
  deleteResourceWorkspaceService,
  renameResourceWorkspaceService,
} from "@/lib/resource-service"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

async function parseWorkspaceId(context: RouteContext) {
  const params = await Promise.resolve(context.params)
  return z.string().uuid().parse(params.id)
}

const renameSchema = z.object({
  name: z.string().trim().min(1).max(80),
})

export async function PATCH(request: Request, context: RouteContext) {
  try {
    validateCSRF(request)

    const session = await auth()
    if (!session?.user?.id) {
      return errorResponse("Authentication required.", 401)
    }

    const workspaceId = await parseWorkspaceId(context)
    const payload = await request.json() as unknown
    const { name } = renameSchema.parse(payload)

    const { mode, workspace } = await renameResourceWorkspaceService(
      workspaceId,
      name,
      session.user.id,
    )

    return NextResponse.json({ mode, workspace })
  } catch (error) {
    if (error instanceof CSRFValidationError) {
      return errorResponse("Invalid request origin.", 403)
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload.", details: error.flatten() }, { status: 400 })
    }
    if (error instanceof ResourceWorkspaceNotFoundError) {
      return errorResponse(error.message, 404)
    }
    if (error instanceof ResourceWorkspaceAlreadyExistsError) {
      return errorResponse(error.message, 409)
    }
    return errorResponse("Unexpected server error.", 500)
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    validateCSRF(request)

    const session = await auth()
    if (!session?.user?.id) {
      return errorResponse("Authentication required.", 401)
    }

    const workspaceId = await parseWorkspaceId(context)
    const { mode } = await deleteResourceWorkspaceService(workspaceId, session.user.id)

    return NextResponse.json({ mode, ok: true })
  } catch (error) {
    if (error instanceof CSRFValidationError) {
      return errorResponse("Invalid request origin.", 403)
    }

    if (error instanceof ResourceWorkspaceNotFoundError) {
      return errorResponse(error.message, 404)
    }
    return errorResponse("Unexpected server error.", 500)
  }
}
