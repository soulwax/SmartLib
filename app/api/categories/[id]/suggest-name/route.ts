import { NextResponse } from "next/server"
import { createApiErrorResponse } from "@/lib/api-error"
import { z } from "zod"

import { auth } from "@/auth"
import { MissingAiApiKeyError } from "@/lib/ai-provider"
import { CSRFValidationError, validateCSRF } from "@/lib/csrf-protection"
import { suggestShortCategoryNameFromLinks } from "@/lib/category-name-suggester"
import {
  asRateLimitJsonResponse,
  assertRequestRateLimit,
  RATE_LIMIT_RULES,
} from "@/lib/rate-limit"
import {
  listResourceCategoriesService,
  listResourcesService,
} from "@/lib/resource-service"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

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

async function parseCategoryId(context: RouteContext) {
  const params = await Promise.resolve(context.params)
  return z.string().uuid().parse(params.id)
}

export async function POST(request: Request, context: RouteContext) {
  try {
    validateCSRF(request)

    const session = await auth()
    if (!session?.user?.id) {
      return errorResponse("Authentication required.", 401)
    }

    await assertRequestRateLimit(request, RATE_LIMIT_RULES.AI_REQUESTS, {
      userId: session.user.id,
      message: "Category rename suggestion limit reached. Please try again shortly.",
    })

    const categoryId = await parseCategoryId(context)
    const includeAllWorkspaces = session.user.isFirstAdmin === true
    const { categories } = await listResourceCategoriesService({
      userId: session.user.id,
      includeAllWorkspaces,
    })

    const category = categories.find((item) => item.id === categoryId)
    if (!category) {
      return errorResponse(`Category ${categoryId} was not found.`, 404)
    }

    const isOwner = category.ownerUserId === session.user.id
    if (!session.user.isAdmin && !isOwner) {
      return errorResponse("Insufficient permissions for editing this category.", 403)
    }

    const { resources } = await listResourcesService({
      userId: session.user.id,
      includeAllWorkspaces,
    })

    const categoryLinks = resources
      .filter(
        (resource) =>
          resource.workspaceId === category.workspaceId &&
          resource.category.toLowerCase() === category.name.toLowerCase()
      )
      .flatMap((resource) =>
        resource.links.map((link) => ({
          url: link.url,
          label: link.label,
          note: link.note ?? null,
        }))
      )

    if (categoryLinks.length === 0) {
      return errorResponse(
        "No links found in this category. Add resources first, then try AI rename.",
        400
      )
    }

    const { suggestedName, model } = await suggestShortCategoryNameFromLinks({
      currentName: category.name,
      links: categoryLinks,
    })

    return NextResponse.json({
      suggestedName,
      model,
      analyzedLinks: categoryLinks.length,
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
      return errorResponse("Invalid category identifier.", 400, { code: "VALIDATION_ERROR", details: error.flatten() })
    }

    if (error instanceof MissingAiApiKeyError) {
      return errorResponse(error.message, 503)
    }

    return errorResponse(
      error instanceof Error ? error.message : "Unexpected server error.",
      500
    )
  }
}
