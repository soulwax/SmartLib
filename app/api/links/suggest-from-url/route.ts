import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { canCreateResources, deriveUserRole } from "@/lib/authorization"
import { CSRFValidationError, validateCSRF } from "@/lib/csrf-protection"
import {
  MissingPerplexityApiKeyError,
  suggestLinkDetailsFromUrl,
} from "@/lib/link-paste-suggester"
import { normalizeHttpUrl } from "@/lib/link-paste"

export const runtime = "nodejs"

const requestSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  categories: z.array(z.string().trim().min(1).max(80)).max(200).optional(),
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
      return errorResponse("Insufficient permissions for AI paste suggestions.", 403)
    }

    const payload = await readRequestJson(request)
    const input = requestSchema.parse(payload)
    const normalizedUrl = normalizeHttpUrl(input.url)
    if (!normalizedUrl) {
      return errorResponse("A valid http(s) URL is required.", 400)
    }

    const suggestion = await suggestLinkDetailsFromUrl({
      url: normalizedUrl,
      categories: input.categories,
    })

    return NextResponse.json({
      url: normalizedUrl,
      label: suggestion.label,
      note: suggestion.note,
      category: suggestion.category,
      tags: suggestion.tags,
      model: suggestion.model,
    })
  } catch (error) {
    if (error instanceof CSRFValidationError) {
      return errorResponse("Invalid request origin.", 403)
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Invalid paste payload.",
          details: error.flatten(),
        },
        { status: 400 }
      )
    }

    if (error instanceof MissingPerplexityApiKeyError) {
      return errorResponse(error.message, 503)
    }

    return errorResponse(
      error instanceof Error ? error.message : "Unexpected server error.",
      500
    )
  }
}
