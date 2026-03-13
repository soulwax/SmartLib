import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { createApiErrorResponse, readRequestJson } from "@/lib/api-error"
import { canCreateResources, deriveUserRole } from "@/lib/authorization"
import { CSRFValidationError, validateCSRF } from "@/lib/csrf-protection"
import {
  asRateLimitJsonResponse,
  assertRequestRateLimit,
  RATE_LIMIT_RULES,
} from "@/lib/rate-limit"
import { ResourceWorkspaceNotFoundError } from "@/lib/resource-repository"
import { createResourceService } from "@/lib/resource-service"
import { parseTobyJsonImport } from "@/lib/toby-import"

export const runtime = "nodejs"

const tobyImportSchema = z.object({
  workspaceId: z.string().uuid(),
  content: z.string().trim().min(1).max(2_000_000),
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

export async function POST(request: Request) {
  try {
    validateCSRF(request)

    const session = await auth()
    await assertRequestRateLimit(request, RATE_LIMIT_RULES.WRITE_REQUESTS, {
      userId: session?.user?.id ?? null,
      message: "Too many write actions. Please slow down and try again.",
    })

    if (!session?.user?.id) {
      return errorResponse("Authentication required.", 401)
    }

    const role = deriveUserRole({
      role: session.user.role,
      isAdmin: session.user.isAdmin,
      isFirstAdmin: session.user.isFirstAdmin,
    })
    if (!canCreateResources(role)) {
      return errorResponse("Insufficient permissions for importing resources.", 403)
    }

    const payload = await readRequestJson(request)
    const input = tobyImportSchema.parse(payload)
    const parsedImport = parseTobyJsonImport(input.content)

    let mode: "database" | "mock" | undefined
    let importedResources = 0
    let failed = 0

    for (const resource of parsedImport.resources) {
      try {
        const result = await createResourceService(
          {
            ...resource,
            workspaceId: input.workspaceId,
          },
          {
            ownerUserId: session.user.id,
            includeAllWorkspaces: session.user.isFirstAdmin === true,
          },
        )
        mode = result.mode
        importedResources += 1
      } catch (error) {
        if (error instanceof ResourceWorkspaceNotFoundError) {
          throw error
        }

        failed += 1
      }
    }

    if (importedResources === 0) {
      return errorResponse("No Toby cards could be imported.", 500, {
        details: {
          importedLists: parsedImport.importedLists,
          importedCards: parsedImport.importedCards,
          failed,
        },
      })
    }

    return NextResponse.json(
      {
        mode,
        importedLists: parsedImport.importedLists,
        importedCards: parsedImport.importedCards,
        importedResources,
        failed,
      },
      { status: 201 },
    )
  } catch (error) {
    const rateLimited = asRateLimitJsonResponse(error)
    if (rateLimited) {
      return rateLimited
    }

    if (error instanceof CSRFValidationError) {
      return errorResponse("Invalid request origin.", 403)
    }

    if (error instanceof z.ZodError) {
      return errorResponse("Invalid Toby import payload.", 400, {
        code: "VALIDATION_ERROR",
        details: error.flatten(),
      })
    }

    if (error instanceof ResourceWorkspaceNotFoundError) {
      return errorResponse(
        "The selected workspace is no longer available. Refresh the library and choose a current workspace.",
        404,
      )
    }

    return errorResponse("Unexpected server error.", 500)
  }
}
