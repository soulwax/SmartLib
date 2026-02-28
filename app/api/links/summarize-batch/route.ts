import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { canCreateResources, deriveUserRole } from "@/lib/authorization"
import { summarizeAiInboxBatch } from "@/lib/ai-inbox-summarizer"
import { CSRFValidationError, validateCSRF } from "@/lib/csrf-protection"

export const runtime = "nodejs"

const MAX_ITEMS = 25

const requestSchema = z.object({
  useAi: z.boolean().optional(),
  items: z
    .array(
      z.object({
        url: z.string().trim().min(1).max(2048),
        label: z.string().trim().max(240).optional(),
        note: z.string().trim().max(400).optional(),
        category: z.string().trim().max(80).nullable().optional(),
        tags: z.array(z.string().trim().max(40)).max(12).optional(),
        exactMatchCount: z.number().int().min(0).max(50).optional(),
        nearMatchCount: z.number().int().min(0).max(50).optional(),
      })
    )
    .min(1)
    .max(MAX_ITEMS),
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

    const session = await auth()
    if (!session?.user?.id) {
      return errorResponse("Authentication required.", 401)
    }

    const role = deriveUserRole({
      role: session.user.role,
      isAdmin: session.user.isAdmin,
      isFirstAdmin: session.user.isFirstAdmin,
    })
    if (!canCreateResources(role)) {
      return errorResponse("Insufficient permissions for AI inbox summary.", 403)
    }

    const payload = await readRequestJson(request)
    const input = requestSchema.parse(payload)
    const summary = await summarizeAiInboxBatch({
      items: input.items,
      useAi: input.useAi === true,
    })

    return NextResponse.json({
      ...summary,
      analyzed: input.items.length,
    })
  } catch (error) {
    if (error instanceof CSRFValidationError) {
      return errorResponse("Invalid request origin.", 403)
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Invalid AI inbox summary payload.",
          details: error.flatten(),
        },
        { status: 400 }
      )
    }

    return errorResponse(
      error instanceof Error ? error.message : "Unexpected server error.",
      500
    )
  }
}
