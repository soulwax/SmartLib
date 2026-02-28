import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import {
  CannotDeleteFirstAdminError,
  deleteAuthUserAccount,
  UserNotFoundError,
} from "@/lib/auth-service"
import { CSRFValidationError, validateCSRF } from "@/lib/csrf-protection"
import {
  asRateLimitJsonResponse,
  assertRequestRateLimit,
  RATE_LIMIT_RULES,
} from "@/lib/rate-limit"

export const runtime = "nodejs"

const DELETE_CONFIRM_TEXT = "DELETE MY ACCOUNT"

const deleteAccountSchema = z.object({
  email: z.string().trim().email().max(320),
  confirmation: z.string().trim(),
  exportConfirmed: z.literal(true),
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

export async function DELETE(request: Request) {
  try {
    validateCSRF(request)
    const session = await auth()

    if (!session?.user?.id || !session.user.email) {
      return errorResponse("Authentication required.", 401)
    }

    await assertRequestRateLimit(request, RATE_LIMIT_RULES.AUTH_ACCOUNT_DELETE, {
      userId: session.user.id,
      message: "Too many account deletion attempts. Please wait and try again.",
    })

    const payload = await readRequestJson(request)
    const input = deleteAccountSchema.parse(payload)

    const normalizedInputEmail = input.email.trim().toLowerCase()
    const normalizedSessionEmail = session.user.email.trim().toLowerCase()
    if (normalizedInputEmail !== normalizedSessionEmail) {
      return errorResponse("Confirmation email does not match signed-in account.", 400)
    }

    if (input.confirmation !== DELETE_CONFIRM_TEXT) {
      return errorResponse("Delete confirmation text mismatch.", 400)
    }

    const { mode } = await deleteAuthUserAccount(session.user.id)
    return NextResponse.json({ ok: true, mode })
  } catch (error) {
    const rateLimited = asRateLimitJsonResponse(error)
    if (rateLimited) {
      return rateLimited
    }

    if (error instanceof CSRFValidationError) {
      return errorResponse("Invalid request origin.", 403)
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Invalid account deletion payload.",
          details: error.flatten(),
        },
        { status: 400 }
      )
    }

    if (error instanceof CannotDeleteFirstAdminError) {
      return errorResponse(
        "FirstAdmin account cannot be deleted. Transfer FirstAdmin first.",
        409
      )
    }

    if (error instanceof UserNotFoundError) {
      return errorResponse("Account not found.", 404)
    }

    return errorResponse("Unexpected server error.", 500)
  }
}
