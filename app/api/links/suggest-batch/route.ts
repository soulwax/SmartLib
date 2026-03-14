import { NextResponse } from "next/server"
import { createApiErrorResponse } from "@/lib/api-error"
import { z } from "zod"

import { auth } from "@/auth"
import { MissingAiApiKeyError } from "@/lib/ai-provider"
import { canCreateResources, deriveUserRole } from "@/lib/authorization"
import { CSRFValidationError, validateCSRF } from "@/lib/csrf-protection"
import {
  asRateLimitJsonResponse,
  assertRequestRateLimit,
  RATE_LIMIT_RULES,
} from "@/lib/rate-limit"
import { detectLinkDuplicates } from "@/lib/link-duplicate-detection"
import { suggestLinkDetailsFromUrl } from "@/lib/link-paste-suggester"
import {
  buildLinkDraftFromUrl,
  normalizeDraftCategory,
  normalizeDraftLabel,
  normalizeDraftNote,
  normalizeDraftTags,
  normalizeHttpUrl,
} from "@/lib/link-paste"
import { listResourcesService } from "@/lib/resource-service"

export const runtime = "nodejs"

const MAX_BATCH_URLS = 25
const ANALYZE_CONCURRENCY = 4

const requestSchema = z.object({
  urls: z.array(z.string().trim().min(1).max(2048)).min(1).max(MAX_BATCH_URLS),
  categories: z.array(z.string().trim().min(1).max(80)).max(200).optional(),
  workspaceId: z.string().uuid().nullable().optional(),
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

function normalizeCategoryHints(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const value of values ?? []) {
    const item = value.replace(/\s+/g, " ").trim().slice(0, 80)
    if (!item) {
      continue
    }

    const key = item.toLowerCase()
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    normalized.push(item)
  }

  return normalized.slice(0, 200)
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

async function mapWithConcurrency<T, TResult>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<TResult>
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length)
  let nextIndex = 0

  const workers = Array.from({
    length: Math.max(1, Math.min(concurrency, items.length)),
  }).map(async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  })

  await Promise.all(workers)
  return results
}

export async function POST(request: Request) {
  try {
    validateCSRF(request)

    const session = await auth()
    await assertRequestRateLimit(request, RATE_LIMIT_RULES.AI_REQUESTS, {
      userId: session?.user?.id ?? null,
      message: "AI request rate limit reached. Please wait and try again.",
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
      return errorResponse("Insufficient permissions for AI inbox suggestions.", 403)
    }

    const payload = await readRequestJson(request)
    const input = requestSchema.parse(payload)
    const normalizedUrls = input.urls
      .map((url) => normalizeHttpUrl(url))
      .filter((url): url is string => Boolean(url))

    if (normalizedUrls.length === 0) {
      return errorResponse("At least one valid http(s) URL is required.", 400)
    }

    const includeAllWorkspaces = session.user.isFirstAdmin === true
    const { resources } = await listResourcesService({
      userId: session.user.id,
      includeAllWorkspaces,
    })
    const duplicateScopeResources = input.workspaceId
      ? resources.filter((resource) => resource.workspaceId === input.workspaceId)
      : resources

    const categoryHints = normalizeCategoryHints(input.categories)
    const shouldUseAi = input.useAi === true
    const items = await mapWithConcurrency(
      normalizedUrls,
      ANALYZE_CONCURRENCY,
      async (url) => {
        const fallback = buildLinkDraftFromUrl(url)
        let label = fallback.label
        let note = fallback.note
        let category = normalizeDraftCategory(fallback.category ?? "")
        let tags = normalizeDraftTags(fallback.tags ?? [])
        let model: string | null = null
        let usedAi = false
        let error: string | null = null

        if (shouldUseAi) {
          try {
            const suggestion = await suggestLinkDetailsFromUrl({
              url,
              categories: categoryHints,
            })

            label = normalizeDraftLabel(suggestion.label)
            note = normalizeDraftNote(suggestion.note)
            category = normalizeDraftCategory(suggestion.category ?? "")
            tags = normalizeDraftTags(suggestion.tags ?? [])
            model = suggestion.model
            usedAi = true
          } catch (suggestionError) {
            if (suggestionError instanceof MissingAiApiKeyError) {
              error = suggestionError.message
            } else {
              error =
                suggestionError instanceof Error
                  ? suggestionError.message
                  : "AI suggestion failed."
            }
          }
        }

        const duplicateInsight = detectLinkDuplicates({
          links: [{ url, label }],
          resources: duplicateScopeResources,
          workspaceId: input.workspaceId ?? null,
        })

        return {
          url,
          label,
          note,
          category,
          tags,
          model,
          usedAi,
          error,
          exactMatches: duplicateInsight.exactMatches,
          nearMatches: duplicateInsight.nearMatches,
        }
      }
    )

    return NextResponse.json({
      items,
      analyzed: items.length,
      aiRequested: shouldUseAi,
      aiApplied: items.filter((item) => item.usedAi).length,
    })
  } catch (error) {
    const rateLimited = asRateLimitJsonResponse(error)
    if (rateLimited) {
      return rateLimited
    }

    if (error instanceof CSRFValidationError) {
      return errorResponse("Invalid request origin.", 403)
    }

    if (error instanceof z.ZodError) {
      return errorResponse("Invalid batch paste payload.", 400, { code: "VALIDATION_ERROR", details: error.flatten() })
    }

    return errorResponse(
      error instanceof Error ? error.message : "Unexpected server error.",
      500
    )
  }
}
