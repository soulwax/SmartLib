import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { ResourceCategoryNotFoundError } from "@/lib/resource-repository"
import {
  deleteResourceCategoryService,
  updateResourceCategorySymbolService,
} from "@/lib/resource-service"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

async function parseCategoryId(context: RouteContext) {
  const params = await Promise.resolve(context.params)
  return z.string().uuid().parse(params.id)
}

const updateCategorySchema = z.object({
  symbol: z.string().trim().max(16).nullable().optional(),
})

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return errorResponse("Authentication required.", 401)
    }
    if (!session.user.isAdmin) {
      return errorResponse("Admin access required.", 403)
    }

    const categoryId = await parseCategoryId(context)
    const result = await deleteResourceCategoryService(categoryId, {
      actorUserId: session.user.id,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Invalid category identifier.",
          details: error.flatten(),
        },
        { status: 400 }
      )
    }

    if (error instanceof ResourceCategoryNotFoundError) {
      return errorResponse(error.message, 404)
    }

    return errorResponse("Unexpected server error.", 500)
  }
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

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return errorResponse("Authentication required.", 401)
    }
    if (!session.user.isAdmin) {
      return errorResponse("Admin access required.", 403)
    }

    const categoryId = await parseCategoryId(context)
    const payload = await readRequestJson(request)
    const input = updateCategorySchema.parse(payload)
    const { mode, category } = await updateResourceCategorySymbolService(
      categoryId,
      input.symbol ?? null,
      { actorUserId: session.user.id }
    )

    return NextResponse.json({ mode, category })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Invalid category payload.",
          details: error.flatten(),
        },
        { status: 400 }
      )
    }

    if (error instanceof ResourceCategoryNotFoundError) {
      return errorResponse(error.message, 404)
    }

    return errorResponse("Unexpected server error.", 500)
  }
}
