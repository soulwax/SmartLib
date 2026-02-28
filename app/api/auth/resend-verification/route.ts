import { NextResponse } from "next/server"
import { z } from "zod"

import {
  resendAuthVerificationEmail,
  UserNotFoundError,
} from "@/lib/auth-service"
import { CSRFValidationError, validateCSRF } from "@/lib/csrf-protection"

export const runtime = "nodejs"

const resendSchema = z.object({
  email: z.string().trim().email().max(320),
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
    const input = resendSchema.parse(payload)
    const { mode, delivered, alreadyVerified } = await resendAuthVerificationEmail(
      input.email
    )

    return NextResponse.json({
      mode,
      alreadyVerified,
      verificationEmailMode: delivered.mode,
      verificationPreviewUrl: delivered.previewUrl ?? null,
      ok: true,
    })
  } catch (error) {
    if (error instanceof CSRFValidationError) {
      return errorResponse("Invalid request origin.", 403)
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Invalid resend payload.",
          details: error.flatten(),
        },
        { status: 400 }
      )
    }

    if (error instanceof UserNotFoundError) {
      return errorResponse(
        "Account not found. Register first, then verify your email.",
        404
      )
    }

    return errorResponse("Unexpected server error.", 500)
  }
}
