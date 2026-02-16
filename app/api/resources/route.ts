import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { ResourceNotFoundError } from "@/lib/resource-repository"
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
    const { mode, resources } = await listResourcesService()
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

    const payload = await readRequestJson(request)
    const input = parseResourceInput(payload)
    const { mode, resource } = await createResourceService(input)

    return NextResponse.json({ mode, resource }, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
