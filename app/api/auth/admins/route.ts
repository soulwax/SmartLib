import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import {
  NotFirstAdminError,
  promoteAuthUserToAdmin,
  UserNotFoundError,
} from "@/lib/auth-service"

export const runtime = "nodejs"

const promoteSchema = z.object({
  identifier: z.string().trim().min(1).max(320),
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

    const payload = await readRequestJson(request)
    const input = promoteSchema.parse(payload)
    const { mode, user } = await promoteAuthUserToAdmin(
      session.user.id,
      input.identifier
    )

    return NextResponse.json({
      mode,
      user: {
        id: user.id,
        email: user.email,
        isAdmin: user.isAdmin,
        isFirstAdmin: user.isFirstAdmin,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Invalid request payload.",
          details: error.flatten(),
        },
        { status: 400 }
      )
    }

    if (error instanceof NotFirstAdminError) {
      return errorResponse("Only FirstAdmin can promote admins.", 403)
    }

    if (error instanceof UserNotFoundError) {
      return errorResponse(
        "Target user not found. Ask them to sign in at least once first.",
        404
      )
    }

    return errorResponse("Unexpected server error.", 500)
  }
}
