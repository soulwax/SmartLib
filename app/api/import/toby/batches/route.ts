import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { createApiErrorResponse } from "@/lib/api-error"
import {
  isTobyImportBatchStorageUnavailableError,
  listRecentTobyImportBatches,
} from "@/lib/toby-import-batch-service"

export const runtime = "nodejs"

const querySchema = z.object({
  workspaceId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(12).optional(),
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

export async function GET(request: Request) {
  const session = await auth()

  if (!session?.user?.id) {
    return errorResponse("Authentication required.", 401)
  }

  try {
    const url = new URL(request.url)
    const query = querySchema.parse({
      workspaceId: url.searchParams.get("workspaceId") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    })

    const batches = await listRecentTobyImportBatches({
      userId: session.user.id,
      workspaceId: query.workspaceId,
      limit: query.limit,
    })

    return NextResponse.json({
      batches,
      storageAvailable: true,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse("Invalid Toby import history query.", 400, {
        code: "VALIDATION_ERROR",
        details: error.flatten(),
      })
    }

    if (isTobyImportBatchStorageUnavailableError(error)) {
      return NextResponse.json({
        batches: [],
        storageAvailable: false,
      })
    }

    console.error("Error in /api/import/toby/batches GET handler:", error)
    return errorResponse("Unexpected server error.", 500)
  }
}
