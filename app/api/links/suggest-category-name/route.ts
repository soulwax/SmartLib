import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { canCreateResources, deriveUserRole } from "@/lib/authorization"
import { suggestShortCategoryNameFromLinks } from "@/lib/category-name-suggester"
import { CSRFValidationError, validateCSRF } from "@/lib/csrf-protection"

export const runtime = "nodejs"

const MAX_LINKS = 64
const MAX_NAME_LENGTH = 80
const GENERIC_CATEGORY_NAMES = new Set([
  "all",
  "general",
  "misc",
  "miscellaneous",
  "links",
  "uncategorized",
  "untitled",
])

const requestSchema = z.object({
  currentName: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  links: z
    .array(
      z.object({
        url: z.string().trim().min(1).max(2048),
        label: z.string().trim().max(240).optional().nullable(),
        note: z.string().trim().max(400).optional().nullable(),
      })
    )
    .min(1)
    .max(MAX_LINKS),
  useAi: z.boolean().optional(),
})

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function toShortCategoryName(value: string): string {
  const cleaned = normalizeWhitespace(value).replace(/^[`"'#]+|[`"'#]+$/g, "")
  if (!cleaned) {
    return "General"
  }

  return cleaned
    .split(" ")
    .slice(0, 3)
    .join(" ")
    .slice(0, 28)
}

function toTitleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((token) => token[0].toUpperCase() + token.slice(1).toLowerCase())
    .join(" ")
}

function extractFallbackNameFromLinks(links: Array<{ url: string }>): string | null {
  const counts = new Map<string, number>()
  for (const link of links) {
    try {
      const host = new URL(link.url).hostname.replace(/^www\./i, "").toLowerCase()
      const hostParts = host.split(".")
      const core =
        hostParts.length >= 2 ? hostParts[hostParts.length - 2] ?? host : host
      const normalized = normalizeWhitespace(core).replace(/[^a-z0-9-]+/gi, "")
      if (!normalized) {
        continue
      }
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
    } catch {
      continue
    }
  }

  const top = [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
  )[0]?.[0]

  if (!top) {
    return null
  }

  return toTitleCase(top)
}

function buildFallbackCategoryName(
  currentName: string,
  links: Array<{ url: string }>
): string {
  const shortCurrent = toShortCategoryName(currentName)
  if (!GENERIC_CATEGORY_NAMES.has(shortCurrent.toLowerCase())) {
    return shortCurrent
  }

  const fromLinks = extractFallbackNameFromLinks(links)
  if (fromLinks) {
    return toShortCategoryName(fromLinks)
  }

  return "General"
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
      return errorResponse("Insufficient permissions for category name suggestion.", 403)
    }

    const payload = await readRequestJson(request)
    const input = requestSchema.parse(payload)
    const fallbackName = buildFallbackCategoryName(input.currentName, input.links)

    if (input.useAi !== true) {
      return NextResponse.json({
        suggestedName: fallbackName,
        usedAi: false,
        model: null,
        warning: null,
      })
    }

    try {
      const aiResult = await suggestShortCategoryNameFromLinks({
        currentName: input.currentName,
        links: input.links.map((link) => ({
          url: link.url,
          label: link.label ?? null,
          note: link.note ?? null,
        })),
      })

      return NextResponse.json({
        suggestedName: toShortCategoryName(aiResult.suggestedName),
        usedAi: true,
        model: aiResult.model,
        warning: null,
      })
    } catch (error) {
      return NextResponse.json({
        suggestedName: fallbackName,
        usedAi: false,
        model: null,
        warning:
          error instanceof Error
            ? error.message
            : "AI category naming failed. Returned fallback name.",
      })
    }
  } catch (error) {
    if (error instanceof CSRFValidationError) {
      return errorResponse("Invalid request origin.", 403)
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Invalid category name suggestion payload.",
          details: error.flatten(),
        },
        { status: 400 }
      )
    }

    return errorResponse(
      error instanceof Error ? error.message : "Unexpected server error.",
      500
    )
  }
}
