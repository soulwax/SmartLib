import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { CSRFValidationError, validateCSRF } from "@/lib/csrf-protection"
import {
  ResourceCategoryAlreadyExistsError,
  ResourceWorkspaceNotFoundError,
} from "@/lib/resource-repository"
import {
  createResourceCategoryService,
  listResourceCategoriesService,
} from "@/lib/resource-service"

export const runtime = "nodejs"

const createCategorySchema = z.object({
  workspaceId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  symbol: z.string().trim().max(16).optional().nullable(),
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

export async function GET(request: Request) {
  try {
    const session = await auth()
    const workspaceId = new URL(request.url).searchParams.get("workspaceId")
    const { mode, categories } = await listResourceCategoriesService({
      userId: session?.user?.id ?? null,
      workspaceId,
      includeAllWorkspaces: session?.user?.isFirstAdmin === true,
    })
    return NextResponse.json({ mode, categories })
  } catch {
    return errorResponse("Unexpected server error.", 500)
  }
}

export async function POST(request: Request) {
  try {
    validateCSRF(request)

    const session = await auth()
    if (!session?.user?.id) {
      return errorResponse("Authentication required.", 401)
    }
    if (!session.user.isAdmin) {
      return errorResponse("Admin access required.", 403)
    }

    const payload = await readRequestJson(request)
    const input = createCategorySchema.parse(payload)
    const { mode, category } = await createResourceCategoryService(
      input.name,
      input.symbol ?? null,
      {
        workspaceId: input.workspaceId,
        ownerUserId: session.user.id,
        includeAllWorkspaces: session.user.isFirstAdmin === true,
      }
    )

    return NextResponse.json({ mode, category }, { status: 201 })
  } catch (error) {
    if (error instanceof CSRFValidationError) {
      return errorResponse("Invalid request origin.", 403)
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Invalid category payload.",
          details: error.flatten(),
        },
        { status: 400 }
      )
    }

    if (error instanceof ResourceCategoryAlreadyExistsError) {
      return errorResponse(error.message, 409)
    }

    if (error instanceof ResourceWorkspaceNotFoundError) {
      return errorResponse(error.message, 404)
    }

    return errorResponse("Unexpected server error.", 500)
  }
}
