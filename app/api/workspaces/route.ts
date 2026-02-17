import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import {
  ResourceWorkspaceAlreadyExistsError,
  ResourceWorkspaceLimitReachedError,
} from "@/lib/resource-repository"
import {
  createResourceWorkspaceService,
  listResourceWorkspacesService,
} from "@/lib/resource-service"

export const runtime = "nodejs"

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(80),
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

export async function GET() {
  try {
    const session = await auth()
    const { mode, workspaces } = await listResourceWorkspacesService({
      userId: session?.user?.id ?? null,
    })

    return NextResponse.json({ mode, workspaces })
  } catch {
    return errorResponse("Unexpected server error.", 500)
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return errorResponse("Authentication required.", 401)
    }

    const payload = await readRequestJson(request)
    const input = createWorkspaceSchema.parse(payload)
    const { mode, workspace } = await createResourceWorkspaceService(
      input.name,
      { ownerUserId: session.user.id }
    )

    return NextResponse.json({ mode, workspace }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Invalid workspace payload.",
          details: error.flatten(),
        },
        { status: 400 }
      )
    }

    if (error instanceof ResourceWorkspaceAlreadyExistsError) {
      return errorResponse(error.message, 409)
    }

    if (error instanceof ResourceWorkspaceLimitReachedError) {
      return errorResponse(error.message, 409)
    }

    return errorResponse("Unexpected server error.", 500)
  }
}
