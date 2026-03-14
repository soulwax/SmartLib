import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { createApiErrorResponse, readRequestJson } from "@/lib/api-error"
import { canCreateResources, deriveUserRole } from "@/lib/authorization"
import { CSRFValidationError, validateCSRF } from "@/lib/csrf-protection"
import {
  buildExactDuplicateKey,
  detectLinkDuplicates,
} from "@/lib/link-duplicate-detection"
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
  listResourcesService,
  listResourceWorkspacesService,
} from "@/lib/resource-service"
import { parseTobyJsonImport } from "@/lib/toby-import"
import {
  createTobyImportBatch,
  isTobyImportBatchStorageUnavailableError,
} from "@/lib/toby-import-batch-service"

export const runtime = "nodejs"
const DUPLICATE_SAMPLE_LIMIT = 5

const tobyImportSchema = z.object({
  organizationId: z.string().uuid().nullable().optional(),
  workspaceId: z.string().uuid().optional(),
  createWorkspace: z.boolean().optional().default(false),
  workspaceName: z.string().trim().min(1).max(80).optional(),
  sourceName: z.string().trim().max(200).optional(),
  previewOnly: z.boolean().optional().default(false),
  skipExactDuplicates: z.boolean().optional().default(true),
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

async function assertVisibleWorkspace(
  workspaceId: string,
  options: {
    userId: string
    includeAllWorkspaces: boolean
  },
) {
  const { workspaces } = await listResourceWorkspacesService({
    userId: options.userId,
    includeAllWorkspaces: options.includeAllWorkspaces,
  })

  if (!workspaces.some((workspace) => workspace.id === workspaceId)) {
    throw new ResourceWorkspaceNotFoundError(workspaceId)
  }

  return workspaces.find((workspace) => workspace.id === workspaceId) ?? null
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
    let targetWorkspace: Awaited<
      ReturnType<typeof createResourceWorkspaceService>
    >["workspace"] | null = null
    const inFileDuplicateIndexes = new Set<number>()
    const inFileDuplicateSamples: Array<{
      url: string
      label: string
    }> = []
    const seenImportKeys = new Set<string>()

    parsedImport.resources.forEach((resource, index) => {
      const link = resource.links[0]
      if (!link) {
        return
      }

      const key = buildExactDuplicateKey(link.url) ?? link.url.trim().toLowerCase()
      if (seenImportKeys.has(key)) {
        inFileDuplicateIndexes.add(index)
        if (inFileDuplicateSamples.length < DUPLICATE_SAMPLE_LIMIT) {
          inFileDuplicateSamples.push({
            url: link.url,
            label: link.label,
          })
        }
        return
      }

      seenImportKeys.add(key)
    })

    if (input.createWorkspace && !input.previewOnly) {
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
      targetWorkspace = workspaceResult.workspace
    }

    if (!targetWorkspaceId) {
      if (input.previewOnly && input.createWorkspace) {
        return NextResponse.json(
          {
            importedLists: parsedImport.importedLists,
            importedCards: parsedImport.importedCards,
            exactDuplicateCount: 0,
            inFileDuplicateCount: inFileDuplicateIndexes.size,
            inFileDuplicateSamples,
            duplicateSamples: [],
          },
          { status: 200 },
        )
      }

      return errorResponse("No workspace was selected for the import.", 400)
    }

    targetWorkspace =
      targetWorkspace ??
      (await assertVisibleWorkspace(targetWorkspaceId, {
        userId: session.user.id,
        includeAllWorkspaces: session.user.isFirstAdmin === true,
      }))

    const resourceLinks = parsedImport.resources.map((resource) => resource.links[0])
    const { mode: analysisMode, resources: existingResources } =
      await listResourcesService({
        userId: session.user.id,
        workspaceId: targetWorkspaceId,
        includeAllWorkspaces: session.user.isFirstAdmin === true,
      })

    mode ??= analysisMode

    const duplicateAnalysis = detectLinkDuplicates({
      links: resourceLinks.map((link) => ({
        url: link.url,
        label: link.label,
      })),
      resources: existingResources,
      workspaceId: targetWorkspaceId,
    })

    const exactDuplicateIndexes = new Set<number>()
    const duplicateSamples: Array<{
      url: string
      label: string
      matches: Array<{
        resourceId: string
        category: string
        linkLabel: string
        linkUrl: string
      }>
    }> = []

    duplicateAnalysis.insightsByLink.forEach((insight, index) => {
      if (insight.exactMatches.length === 0) {
        return
      }

      exactDuplicateIndexes.add(index)
      if (duplicateSamples.length >= DUPLICATE_SAMPLE_LIMIT) {
        return
      }

      duplicateSamples.push({
        url: insight.url,
        label: insight.label,
        matches: insight.exactMatches.slice(0, 3).map((match) => ({
          resourceId: match.resourceId,
          category: match.category,
          linkLabel: match.linkLabel,
          linkUrl: match.linkUrl,
        })),
      })
    })

    if (input.previewOnly) {
      return NextResponse.json(
        {
          mode,
          importedLists: parsedImport.importedLists,
          importedCards: parsedImport.importedCards,
          exactDuplicateCount: exactDuplicateIndexes.size,
          inFileDuplicateCount: inFileDuplicateIndexes.size,
          inFileDuplicateSamples,
          duplicateSamples,
        },
        { status: 200 },
      )
    }

    let importedResources = 0
    let failed = 0
    let skippedExactDuplicates = 0
    const createdResourceIds: string[] = []

    for (const [index, resource] of parsedImport.resources.entries()) {
      if (
        input.skipExactDuplicates &&
        (exactDuplicateIndexes.has(index) || inFileDuplicateIndexes.has(index))
      ) {
        skippedExactDuplicates += 1
        continue
      }

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
        createdResourceIds.push(result.resource.id)
      } catch (error) {
        if (error instanceof ResourceWorkspaceNotFoundError) {
          throw error
        }

        console.error("Failed to import Toby card", {
          error,
          workspaceId: targetWorkspaceId,
          index,
        })
        failed += 1
      }
    }

    if (importedResources === 0 && skippedExactDuplicates === 0) {
      return errorResponse("No Toby cards could be imported.", 500, {
        details: {
          importedLists: parsedImport.importedLists,
          importedCards: parsedImport.importedCards,
          skippedExactDuplicates,
          failed,
        },
      })
    }

    let importBatch = null
    let rollbackAvailable = false

    if (createdResourceIds.length > 0 && targetWorkspace) {
      try {
        importBatch = await createTobyImportBatch({
          actorUserId: session.user.id,
          actorIdentifier: session.user.email ?? session.user.id,
          workspaceId: targetWorkspace.id,
          organizationId:
            targetWorkspace.organizationId ?? input.organizationId ?? null,
          workspaceName: targetWorkspace.name,
          sourceName: input.sourceName,
          createdWorkspaceId: createdWorkspace?.id ?? null,
          importedLists: parsedImport.importedLists,
          importedCards: parsedImport.importedCards,
          importedResources,
          skippedExactDuplicates,
          failed,
          resourceIds: createdResourceIds,
        })
        rollbackAvailable = importBatch !== null
      } catch (error) {
        rollbackAvailable = false

        if (!isTobyImportBatchStorageUnavailableError(error)) {
          console.error("Failed to record Toby import batch:", error)
        }
      }
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
        exactDuplicateCount: exactDuplicateIndexes.size,
        inFileDuplicateCount: inFileDuplicateIndexes.size,
        inFileDuplicateSamples,
        skippedExactDuplicates,
        duplicateSamples,
        importedResources,
        failed,
        importBatch,
        rollbackAvailable,
      },
      { status: importedResources > 0 ? 201 : 200 },
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
