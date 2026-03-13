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
import {
  ResourceOrganizationNotFoundError,
  ResourceWorkspaceAlreadyExistsError,
  ResourceWorkspaceLimitReachedError,
  ResourceWorkspaceNotFoundError,
} from "@/lib/resource-repository"
import {
  createResourceService,
  createResourceWorkspaceService,
} from "@/lib/resource-service"
import { parseTobyJsonImport } from "@/lib/toby-import"

export const runtime = "nodejs"

const tobyImportSchema = z.object({
  organizationId: z.string().uuid().nullable().optional(),
  workspaceId: z.string().uuid().optional(),
  createWorkspace: z.boolean().optional().default(false),
  workspaceName: z.string().trim().min(1).max(80).optional(),
  content: z.string().trim().min(1).max(2_000_000),
}).superRefine((value, ctx) => {
  if (value.createWorkspace) {
    if (!value.workspaceName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workspaceName"],
        message: "Workspace name is required when creating a workspace.",
      })
    }
    return
  }

  if (!value.workspaceId?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["workspaceId"],
      message: "Workspace ID is required when importing into the current workspace.",
    })
  }
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
    let createdWorkspace: Awaited<
      ReturnType<typeof createResourceWorkspaceService>
    >["workspace"] | null = null
    let targetWorkspaceId = input.workspaceId ?? null

    if (input.createWorkspace) {
      const workspaceResult = await createResourceWorkspaceService(
        input.workspaceName!,
        {
          ownerUserId: session.user.id,
          organizationId: input.organizationId ?? null,
          includeAllWorkspaces: session.user.isFirstAdmin === true,
        },
      )
      mode = workspaceResult.mode
      createdWorkspace = workspaceResult.workspace
      targetWorkspaceId = workspaceResult.workspace.id
    }

    if (!targetWorkspaceId) {
      return errorResponse("No workspace was selected for the import.", 400)
    }

    let importedResources = 0
    let failed = 0

    for (const resource of parsedImport.resources) {
      try {
        const result = await createResourceService(
          {
            ...resource,
            workspaceId: targetWorkspaceId,
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
        workspace: createdWorkspace,
        workspaceId: targetWorkspaceId,
        organizationId:
          createdWorkspace?.organizationId ?? input.organizationId ?? null,
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

    if (error instanceof ResourceWorkspaceAlreadyExistsError) {
      return errorResponse(error.message, 409)
    }

    if (error instanceof ResourceWorkspaceLimitReachedError) {
      return errorResponse(error.message, 409)
    }

    if (error instanceof ResourceOrganizationNotFoundError) {
      return errorResponse(error.message, 404)
    }

    return errorResponse("Unexpected server error.", 500)
  }
}
