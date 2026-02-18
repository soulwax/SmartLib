import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { canManageResource, deriveUserRole } from "@/lib/authorization"
import {
  getResourceOwnerById,
  ResourceCategoryNotFoundError,
  ResourceMoveConflictError,
  ResourceNotFoundError,
} from "@/lib/resource-repository"
import { moveResourceItemService } from "@/lib/resource-service"

export const runtime = "nodejs"

const moveItemSchema = z.object({
  itemId: z.string().uuid(),
  sourceCategoryId: z.string().uuid(),
  targetCategoryId: z.string().uuid(),
  newOrder: z.number().int().min(0),
})

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
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

    const payload = await readRequestJson(request)
    const input = moveItemSchema.parse(payload)

    const existing = await getResourceOwnerById(input.itemId)
    if (!existing || existing.deletedAt) {
      return errorResponse(`Resource ${input.itemId} was not found.`, 404)
    }
    if (!canManageResource(role, session.user.id, existing.ownerUserId)) {
      return errorResponse("You do not have access to move this resource.", 403)
    }

    const result = await moveResourceItemService(input, {
      actorUserId: session.user.id,
      includeAllWorkspaces: session.user.isFirstAdmin === true,
    })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Invalid move payload.",
          details: error.flatten(),
        },
        { status: 400 }
      )
    }

    if (error instanceof ResourceNotFoundError) {
      return errorResponse(error.message, 404)
    }

    if (error instanceof ResourceCategoryNotFoundError) {
      return errorResponse(error.message, 404)
    }

    if (error instanceof ResourceMoveConflictError) {
      return errorResponse(error.message, 409)
    }

    return errorResponse("Unexpected server error.", 500)
  }
}
