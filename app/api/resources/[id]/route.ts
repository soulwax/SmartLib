import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { canManageResource, deriveUserRole } from "@/lib/authorization"
import {
  getResourceOwnerById,
  ResourceNotFoundError,
  ResourceWorkspaceNotFoundError,
} from "@/lib/resource-repository"
import {
  deleteResourceService,
  updateResourceService,
} from "@/lib/resource-service"
import { parseResourceInput } from "@/lib/resource-validation"
import type { ResourceAuditActor } from "@/lib/resources"

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

async function parseResourceId(context: RouteContext) {
  const params = await Promise.resolve(context.params)
  return z.string().uuid().parse(params.id)
}

function auditActorFromSession(session: Awaited<ReturnType<typeof auth>>): ResourceAuditActor {
  return {
    userId: session?.user?.id ?? null,
    identifier: session?.user?.email ?? session?.user?.id ?? null,
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return errorResponse("Authentication required.", 401)
    }

    const resourceId = await parseResourceId(context)
    const existing = await getResourceOwnerById(resourceId)
    if (!existing) {
      return errorResponse(`Resource ${resourceId} was not found.`, 404)
    }

    const role = deriveUserRole({
      role: session.user.role,
      isAdmin: session.user.isAdmin,
      isFirstAdmin: session.user.isFirstAdmin,
    })
    if (!canManageResource(role, session.user.id, existing.ownerUserId)) {
      return errorResponse("You do not have access to edit this resource.", 403)
    }

    const payload = await readRequestJson(request)
    const input = parseResourceInput(payload)
    const { mode, resource } = await updateResourceService(resourceId, input, {
      ownerUserId: session.user.id,
    })

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
    const existing = await getResourceOwnerById(resourceId)
    if (!existing) {
      return errorResponse(`Resource ${resourceId} was not found.`, 404)
    }

    const role = deriveUserRole({
      role: session.user.role,
      isAdmin: session.user.isAdmin,
      isFirstAdmin: session.user.isFirstAdmin,
    })
    if (!canManageResource(role, session.user.id, existing.ownerUserId)) {
      return errorResponse("You do not have access to archive this resource.", 403)
    }

    const { mode } = await deleteResourceService(
      resourceId,
      auditActorFromSession(session)
    )

    return NextResponse.json({ mode, ok: true })
  } catch (error) {
    return handleRouteError(error)
  }
}
