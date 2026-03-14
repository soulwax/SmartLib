import { NextResponse } from "next/server"
import { createApiErrorResponse } from "@/lib/api-error"
import { z } from "zod"

import { auth } from "@/auth"
import { deriveUserRole, hasAdminAccess } from "@/lib/authorization"
import { previewSmartCategorySplit } from "@/lib/category-smart-split"
import { CSRFValidationError, validateCSRF } from "@/lib/csrf-protection"
import {
  asRateLimitJsonResponse,
  assertRequestRateLimit,
  RATE_LIMIT_RULES,
} from "@/lib/rate-limit"
import {
  ResourceCategoryAlreadyExistsError,
  ResourceCategoryNotFoundError,
} from "@/lib/resource-repository"
import {
  createResourceCategoryService,
  listResourceCategoriesService,
  listResourcesService,
  moveResourceItemService,
  updateResourceCategoryService,
} from "@/lib/resource-service"
import type { ResourceCard, ResourceCategory } from "@/lib/resources"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

const RESOURCE_ORDER_STEP = 1024

const applySplitSchema = z.object({
  retainGroupKey: z.string().trim().min(1).max(80).optional(),
  groups: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(80),
        name: z.string().trim().min(1).max(80),
        resourceIds: z.array(z.string().uuid()).min(1).max(200),
      })
    )
    .min(2)
    .max(6),
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

async function parseCategoryId(context: RouteContext) {
  const params = await Promise.resolve(context.params)
  return z.string().uuid().parse(params.id)
}

async function resolveSplitCategory(options: {
  categoryId: string
  userId: string
  includeAllWorkspaces: boolean
}): Promise<ResourceCategory> {
  const { categories } = await listResourceCategoriesService({
    userId: options.userId,
    includeAllWorkspaces: options.includeAllWorkspaces,
  })

  const category = categories.find((item) => item.id === options.categoryId) ?? null
  if (!category) {
    throw new ResourceCategoryNotFoundError(options.categoryId)
  }

  return category
}

async function listCategoryResources(options: {
  category: ResourceCategory
  userId: string
  includeAllWorkspaces: boolean
}): Promise<ResourceCard[]> {
  const { resources } = await listResourcesService({
    userId: options.userId,
    workspaceId: options.category.workspaceId,
    includeAllWorkspaces: options.includeAllWorkspaces,
  })

  return resources.filter((resource) => {
    if (resource.categoryId) {
      return resource.categoryId === options.category.id
    }

    return resource.category.toLowerCase() === options.category.name.toLowerCase()
  })
}

export async function POST(request: Request, context: RouteContext) {
  try {
    validateCSRF(request)

    const session = await auth()
    await assertRequestRateLimit(request, RATE_LIMIT_RULES.AI_REQUESTS, {
      userId: session?.user?.id ?? null,
      message: "Category split request limit reached. Please try again shortly.",
    })

    if (!session?.user?.id) {
      return errorResponse("Authentication required.", 401)
    }

    const role = deriveUserRole({
      role: session.user.role,
      isAdmin: session.user.isAdmin,
      isFirstAdmin: session.user.isFirstAdmin,
    })
    if (!hasAdminAccess(role)) {
      return errorResponse("Admin access required for smart category split.", 403)
    }

    const categoryId = await parseCategoryId(context)
    const category = await resolveSplitCategory({
      categoryId,
      userId: session.user.id,
      includeAllWorkspaces: session.user.isFirstAdmin === true,
    })
    const categoryResources = await listCategoryResources({
      category,
      userId: session.user.id,
      includeAllWorkspaces: session.user.isFirstAdmin === true,
    })

    const preview = await previewSmartCategorySplit({
      categoryName: category.name,
      resources: categoryResources,
    })

    return NextResponse.json({
      category: {
        id: category.id,
        name: category.name,
        workspaceId: category.workspaceId,
        resourceCount: preview.resourceCount,
      },
      groups: preview.groups,
      warnings: preview.warnings,
      usedAi: preview.usedAi,
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
      return errorResponse("Invalid category split identifier.", 400, {
        code: "VALIDATION_ERROR",
        details: error.flatten(),
      })
    }

    if (error instanceof ResourceCategoryNotFoundError) {
      return errorResponse(error.message, 404)
    }

    return errorResponse(
      error instanceof Error ? error.message : "Unexpected server error.",
      500
    )
  }
}

export async function PUT(request: Request, context: RouteContext) {
  let movedResources = 0

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
    if (!hasAdminAccess(role)) {
      return errorResponse("Admin access required for smart category split.", 403)
    }

    const payload = await readRequestJson(request)
    const input = applySplitSchema.parse(payload)
    const categoryId = await parseCategoryId(context)
    const includeAllWorkspaces = session.user.isFirstAdmin === true
    const category = await resolveSplitCategory({
      categoryId,
      userId: session.user.id,
      includeAllWorkspaces,
    })
    const categoryResources = await listCategoryResources({
      category,
      userId: session.user.id,
      includeAllWorkspaces,
    })

    const resourceMap = new Map(categoryResources.map((resource) => [resource.id, resource]))
    const normalizedGroups = input.groups.map((group) => ({
      key: group.key,
      name: group.name.trim(),
      resourceIds: Array.from(new Set(group.resourceIds)),
    }))
    const nonEmptyGroups = normalizedGroups.filter((group) => group.resourceIds.length > 0)
    if (nonEmptyGroups.length < 2) {
      return errorResponse("Need at least two non-empty target categories.", 400)
    }

    const seenNames = new Set<string>()
    for (const group of nonEmptyGroups) {
      const key = group.name.toLowerCase()
      if (seenNames.has(key)) {
        return errorResponse(`Duplicate target category name "${group.name}".`, 400)
      }
      seenNames.add(key)
    }

    const assignedIds = new Set<string>()
    for (const group of nonEmptyGroups) {
      for (const resourceId of group.resourceIds) {
        if (!resourceMap.has(resourceId)) {
          return errorResponse(`Resource ${resourceId} is not in this category.`, 400)
        }
        if (assignedIds.has(resourceId)) {
          return errorResponse(`Resource ${resourceId} is assigned more than once.`, 400)
        }
        assignedIds.add(resourceId)
      }
    }

    if (assignedIds.size !== categoryResources.length) {
      return errorResponse("Every resource in the category must be assigned exactly once.", 400)
    }

    const retainGroup =
      nonEmptyGroups.find((group) => group.key === input.retainGroupKey) ??
      [...nonEmptyGroups].sort(
        (left, right) => right.resourceIds.length - left.resourceIds.length
      )[0]

    const siblingCategories = (
      await listResourceCategoriesService({
        userId: session.user.id,
        includeAllWorkspaces,
        workspaceId: category.workspaceId,
      })
    ).categories.filter((item) => item.id !== category.id)
    const siblingCategoryNameSet = new Set(
      siblingCategories.map((item) => item.name.trim().toLowerCase())
    )
    for (const group of nonEmptyGroups) {
      if (group.key === retainGroup.key) {
        continue
      }

      if (siblingCategoryNameSet.has(group.name.toLowerCase())) {
        return errorResponse(
          `Category "${group.name}" already exists in this workspace.`,
          409
        )
      }
    }

    let mode: "database" | "mock" = "mock"
    let retainedCategory = category
    if (retainGroup.name.toLowerCase() !== category.name.toLowerCase()) {
      const updated = await updateResourceCategoryService(
        category.id,
        {
          name: retainGroup.name,
        },
        {
          actorUserId: session.user.id,
          includeAllWorkspaces,
        }
      )
      mode = updated.mode
      retainedCategory = updated.category
    }

    const createdCategories: Array<{ id: string; name: string }> = []

    for (const group of nonEmptyGroups) {
      if (group.key === retainGroup.key) {
        continue
      }

      const created = await createResourceCategoryService(group.name, null, {
        workspaceId: category.workspaceId,
        ownerUserId: session.user.id,
        includeAllWorkspaces,
      })
      mode = created.mode
      createdCategories.push({
        id: created.category.id,
        name: created.category.name,
      })

      for (let index = 0; index < group.resourceIds.length; index += 1) {
        await moveResourceItemService(
          {
            itemId: group.resourceIds[index],
            sourceCategoryId: category.id,
            targetCategoryId: created.category.id,
            newOrder: (index + 1) * RESOURCE_ORDER_STEP,
          },
          {
            actorUserId: session.user.id,
            includeAllWorkspaces,
          }
        )
        movedResources += 1
      }
    }

    return NextResponse.json({
      mode,
      category: {
        id: retainedCategory.id,
        name: retainedCategory.name,
        workspaceId: retainedCategory.workspaceId,
      },
      createdCategories,
      movedResources,
      retainedResourceCount: retainGroup.resourceIds.length,
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
      return errorResponse("Invalid smart split payload.", 400, {
        code: "VALIDATION_ERROR",
        details: error.flatten(),
      })
    }

    if (error instanceof ResourceCategoryNotFoundError) {
      return errorResponse(error.message, 404)
    }

    if (error instanceof ResourceCategoryAlreadyExistsError) {
      return errorResponse(error.message, 409)
    }

    const baseMessage =
      error instanceof Error ? error.message : "Unexpected server error."
    const suffix =
      movedResources > 0
        ? " Some changes may already be applied; refresh the library to verify the current state."
        : ""

    return errorResponse(`${baseMessage}${suffix}`, 500)
  }
}
