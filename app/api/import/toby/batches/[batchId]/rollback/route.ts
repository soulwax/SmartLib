import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { createApiErrorResponse } from "@/lib/api-error"
import { deriveUserRole } from "@/lib/authorization"
import { CSRFValidationError, validateCSRF } from "@/lib/csrf-protection"
import {
  asRateLimitJsonResponse,
  assertRequestRateLimit,
  RATE_LIMIT_RULES,
} from "@/lib/rate-limit"
import {
  isTobyImportBatchStorageUnavailableError,
  rollbackTobyImportBatch,
  TobyImportBatchAccessError,
  TobyImportBatchNotFoundError,
} from "@/lib/toby-import-batch-service"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ batchId: string }> | { batchId: string }
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

async function parseBatchId(context: RouteContext) {
  const params = await Promise.resolve(context.params)
  return z.string().uuid().parse(params.batchId)
}

export async function POST(request: Request, context: RouteContext) {
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

    const batchId = await parseBatchId(context)
    const role = deriveUserRole({
      role: session.user.role,
      isAdmin: session.user.isAdmin,
      isFirstAdmin: session.user.isFirstAdmin,
    })

    const result = await rollbackTobyImportBatch({
      batchId,
      actorUserId: session.user.id,
      actorIdentifier: session.user.email ?? session.user.id,
      role,
    })

    return NextResponse.json(result)
  } catch (error) {
    const rateLimited = asRateLimitJsonResponse(error)
    if (rateLimited) {
      return rateLimited
    }

    if (error instanceof CSRFValidationError) {
      return errorResponse("Invalid request origin.", 403)
    }

    if (error instanceof z.ZodError) {
      return errorResponse("Invalid Toby import batch id.", 400)
    }

    if (error instanceof TobyImportBatchNotFoundError) {
      return errorResponse(error.message, 404)
    }

    if (error instanceof TobyImportBatchAccessError) {
      return errorResponse(error.message, 403)
    }

    if (isTobyImportBatchStorageUnavailableError(error)) {
      return errorResponse(
        "Toby import history is not available yet on this deployment.",
        503,
      )
    }

    console.error("Error in /api/import/toby/batches rollback handler:", error)
    return errorResponse("Unexpected server error.", 500)
  }
}
