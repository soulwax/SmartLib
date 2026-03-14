import { NextResponse } from "next/server"
import { createApiErrorResponse } from "@/lib/api-error"
import { z } from "zod"

import { auth } from "@/auth"
import { CSRFValidationError, validateCSRF } from "@/lib/csrf-protection"
import { generateLibraryBrief } from "@/lib/library-brief"
import {
  asRateLimitJsonResponse,
  assertRequestRateLimit,
  RATE_LIMIT_RULES,
} from "@/lib/rate-limit"
import { listResourcesService } from "@/lib/resource-service"

export const runtime = "nodejs"

const requestSchema = z.object({
  workspaceId: z.string().uuid().nullable().optional(),
  category: z.string().trim().min(1).max(80).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  scopeWorkspace: z.boolean().optional(),
  scopeCategory: z.boolean().optional(),
  scopeTags: z.boolean().optional(),
  useAi: z.boolean().optional(),
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
    await assertRequestRateLimit(request, RATE_LIMIT_RULES.AI_REQUESTS, {
      userId: session?.user?.id ?? null,
      message: "Library brief request limit reached. Please try again shortly.",
    })

    const payload = await readRequestJson(request)
    const input = requestSchema.parse(payload)

    const includeAllWorkspaces = session?.user?.isFirstAdmin === true
    const { resources } = await listResourcesService({
      userId: session?.user?.id ?? null,
      includeAllWorkspaces,
    })

    const scopeWorkspace = input.scopeWorkspace !== false
    const scopeCategory = input.scopeCategory !== false
    const scopeTags = input.scopeTags === true
    const scopedTagSet = new Set(
      (scopeTags ? input.tags ?? [] : [])
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag.length > 0)
    )

    const scopedResources = resources.filter((resource) => {
      if (
        scopeWorkspace &&
        input.workspaceId &&
        resource.workspaceId !== input.workspaceId
      ) {
        return false
      }

      if (
        scopeCategory &&
        input.category &&
        input.category.toLowerCase() !== "all" &&
        resource.category.toLowerCase() !== input.category.toLowerCase()
      ) {
        return false
      }

      if (scopedTagSet.size > 0) {
        const hasMatchingTag = resource.tags.some((tag) =>
          scopedTagSet.has(tag.toLowerCase())
        )
        if (!hasMatchingTag) {
          return false
        }
      }

      return true
    })

    const result = await generateLibraryBrief({
      resources: scopedResources,
      useAi: Boolean(input.useAi && session?.user?.id),
    })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof CSRFValidationError) {
      return errorResponse("Invalid request origin.", 403)
    }

    const rateLimited = asRateLimitJsonResponse(error)
    if (rateLimited) {
      return rateLimited
    }

    if (error instanceof z.ZodError) {
      return errorResponse("Invalid library brief payload.", 400, {
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
