import { NextResponse } from "next/server"
import { z } from "zod"

import { registerAuthUser, UserAlreadyExistsError } from "@/lib/auth-service"
import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/password"

export const runtime = "nodejs"

const registerSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
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
    const payload = await readRequestJson(request)
    const input = registerSchema.parse(payload)
    const passwordHash = await hashPassword(input.password)

    const { mode, user } = await registerAuthUser(input.email, passwordHash)

    return NextResponse.json(
      {
        mode,
        user: {
          id: user.id,
          email: user.email,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Invalid registration payload.",
          details: error.flatten(),
        },
        { status: 400 }
      )
    }

    if (error instanceof UserAlreadyExistsError) {
      return errorResponse("A user with this email already exists.", 409)
    }

    return errorResponse("Unexpected server error.", 500)
  }
}
