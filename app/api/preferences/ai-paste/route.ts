import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { CSRFValidationError, validateCSRF } from "@/lib/csrf-protection"
import {
  findAiPastePreferenceByUserId,
  upsertAiPastePreferenceForUser,
} from "@/lib/ai-paste-preference-repository"

export const runtime = "nodejs"

const updateSchema = z.object({
  decision: z.enum(["accepted", "declined"]),
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
    if (!session?.user?.id) {
      return errorResponse("Authentication required.", 401)
    }

    const preference = await findAiPastePreferenceByUserId(session.user.id)
    return NextResponse.json({ decision: preference?.decision ?? null })
  } catch {
    return errorResponse("Unexpected server error.", 500)
  }
}

export async function PUT(request: Request) {
  try {
    validateCSRF(request)

    const session = await auth()
    if (!session?.user?.id) {
      return errorResponse("Authentication required.", 401)
    }

    const payload = await readRequestJson(request)
    const input = updateSchema.parse(payload)

    const preference = await upsertAiPastePreferenceForUser(
      session.user.id,
      input.decision
    )

    return NextResponse.json({ ok: true, decision: preference.decision })
  } catch (error) {
    if (error instanceof CSRFValidationError) {
      return errorResponse("Invalid request origin.", 403)
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Invalid AI paste preference payload.",
          details: error.flatten(),
        },
        { status: 400 }
      )
    }

    return errorResponse("Unexpected server error.", 500)
  }
}
