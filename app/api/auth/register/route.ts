import { NextResponse } from "next/server"
import { z } from "zod"

import { registerAuthUser, UserAlreadyExistsError } from "@/lib/auth-service"
import { CSRFValidationError, validateCSRF } from "@/lib/csrf-protection"
import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/password"

export const runtime = "nodejs"
const GITHUB_FALLBACK_EMAIL_DOMAIN = "github.local"

const registerSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(320)
    .refine(
      (value) =>
        !value
          .toLowerCase()
          .endsWith(`@${GITHUB_FALLBACK_EMAIL_DOMAIN}`),
      {
        message:
          "Email addresses using reserved authentication domains are not allowed.",
      },
    ),
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
    validateCSRF(request)

    const payload = await readRequestJson(request)
    const input = registerSchema.parse(payload)
    const passwordHash = await hashPassword(input.password)

    const { mode, user, verificationDelivery } = await registerAuthUser(
      input.email,
      passwordHash
    )

    return NextResponse.json(
      {
        mode,
        requiresEmailVerification: true,
        verificationEmailMode: verificationDelivery.mode,
        verificationPreviewUrl: verificationDelivery.previewUrl ?? null,
        user: {
          id: user.id,
          email: user.email,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof CSRFValidationError) {
      return errorResponse("Invalid request origin.", 403)
    }

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
