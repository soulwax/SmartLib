import { NextResponse } from "next/server"
import { createApiErrorResponse } from "@/lib/api-error"
import { z } from "zod"

import { auth } from "@/auth"
import { canCreateResources, deriveUserRole } from "@/lib/authorization"
import { refineAiInboxItems } from "@/lib/ai-inbox-refiner"
import { CSRFValidationError, validateCSRF } from "@/lib/csrf-protection"
import {
  asRateLimitJsonResponse,
  assertRequestRateLimit,
  RATE_LIMIT_RULES,
} from "@/lib/rate-limit"

export const runtime = "nodejs"

const MAX_ITEMS = 25

const requestSchema = z.object({
  useAi: z.boolean().optional(),
  categories: z.array(z.string().trim().min(1).max(80)).max(200).optional(),
  items: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(120),
        url: z.string().trim().min(1).max(2048),
        label: z.string().trim().max(240),
        note: z.string().trim().max(400).optional().nullable(),
        category: z.string().trim().max(80).nullable().optional(),
        tags: z.array(z.string().trim().max(40)).max(12).optional(),
      })
    )
    .min(1)
    .max(MAX_ITEMS),
})

function errorResponse(
  message: string,
  status: number,
  options?: {
    code?: string
    details?: unknown
    headers?: HeadersInit
  },
) {
  return createApiErrorResponse({
    message,
    status,
    code: options?.code,
    details: options?.details,
    headers: options?.headers,
  })
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
      return errorResponse("Insufficient permissions for AI inbox refinement.", 403)
    }

    await assertRequestRateLimit(request, RATE_LIMIT_RULES.AI_REQUESTS, {
      userId: session.user.id,
      message: "AI inbox refinement request limit reached. Please try again shortly.",
    })

    const payload = await readRequestJson(request)
    const input = requestSchema.parse(payload)
    const result = await refineAiInboxItems({
      items: input.items,
      categories: input.categories,
      useAi: input.useAi === true,
    })

    return NextResponse.json({
      items: result.items,
      refined: result.items.length,
      usedAi: result.usedAi,
      model: result.model,
      warning: result.warning,
    })
  } catch (error) {
    if (error instanceof CSRFValidationError) {
      return errorResponse("Invalid request origin.", 403)
    }

    const rateLimited = asRateLimitJsonResponse(error)
    if (rateLimited) {
      return rateLimited
    }

    if (error instanceof z.ZodError) {
      return errorResponse("Invalid AI inbox refinement payload.", 400, {
        code: "VALIDATION_ERROR",
        details: error.flatten(),
      })
    }

    return errorResponse(
      error instanceof Error ? error.message : "Unexpected server error.",
      500
    )
  }
}
