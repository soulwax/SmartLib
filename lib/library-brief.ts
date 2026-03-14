import "server-only"

import { generateAiText } from "@/lib/ai-provider"
import type { ResourceCard } from "@/lib/resources"

const MAX_DIGEST_RESOURCES = 80
const MAX_FOCUS_AREAS = 4
const MAX_GAPS = 4
const MAX_SUGGESTED_QUESTIONS = 4

export interface LibraryBriefResult {
  summary: string
  focusAreas: string[]
  gaps: string[]
  suggestedQuestions: string[]
  resourceCount: number
  usedAi: boolean
  model: string | null
  warning: string | null
}

interface GenerateLibraryBriefInput {
  resources: ResourceCard[]
  useAi?: boolean
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function uniqueValues(values: string[], limit: number): string[] {
  const deduped = new Map<string, string>()

  for (const value of values) {
    const normalized = normalizeWhitespace(value).slice(0, 120)
    if (!normalized) {
      continue
    }

    const key = normalized.toLowerCase()
    if (!deduped.has(key)) {
      deduped.set(key, normalized)
    }
  }

  return [...deduped.values()].slice(0, limit)
}

function countValues(values: string[]): Array<[string, number]> {
  const counts = new Map<string, number>()

  for (const value of values) {
    const normalized = normalizeWhitespace(value)
    if (!normalized) {
      continue
    }

    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }

  return [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
  )
}

function parseHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase()
  } catch {
    return "unknown-host"
  }
}

function buildFallbackBrief(resources: ResourceCard[]): LibraryBriefResult {
  const resourceCount = resources.length
  const categoryCounts = countValues(resources.map((resource) => resource.category))
  const topTags = countValues(resources.flatMap((resource) => resource.tags))
  const topHosts = countValues(
    resources.flatMap((resource) => resource.links.map((link) => parseHostname(link.url)))
  )
  const uncategorizedCount = resources.filter((resource) => {
    const normalized = resource.category.trim().toLowerCase()
    return !normalized || normalized === "general" || normalized === "all"
  }).length
  const sparseNoteCount = resources.filter((resource) =>
    resource.links.every((link) => !normalizeWhitespace(link.note ?? ""))
  ).length

  const focusAreas = uniqueValues(
    [
      ...categoryCounts.map(([value]) => value),
      ...topTags.map(([value]) => value),
    ],
    MAX_FOCUS_AREAS
  )

  const gaps: string[] = []
  if (uncategorizedCount > 0) {
    gaps.push(`${uncategorizedCount} resource(s) still sit in generic categories.`)
  }
  if (sparseNoteCount > 0) {
    gaps.push(`${sparseNoteCount} resource(s) are missing notes or context lines.`)
  }
  if (categoryCounts.length <= 2 && resourceCount >= 8) {
    gaps.push("The current scope could use more category separation.")
  }
  if (topHosts[0]?.[1] && topHosts[0][1] >= Math.max(4, Math.ceil(resourceCount * 0.4))) {
    gaps.push(`A large share of the scope depends on ${topHosts[0][0]}.`)
  }

  if (gaps.length === 0) {
    gaps.push("This scope looks fairly balanced and ready for deeper review.")
  }

  const topCategories = categoryCounts.slice(0, 3).map(([value]) => value)
  const suggestedQuestions = uniqueValues(
    [
      topCategories[0]
        ? `What are the strongest resources in ${topCategories[0]}?`
        : "What should I read first in this scope?",
      topCategories[1]
        ? `Where do ${topCategories[0] ?? "these categories"} and ${topCategories[1]} overlap?`
        : "Which category should I strengthen next?",
      topTags[0]?.[0]
        ? `Which saved links best explain ${topTags[0][0]}?`
        : "Which links still need better notes or tags?",
      topHosts[0]?.[0]
        ? `Do we rely too heavily on ${topHosts[0][0]} here?`
        : "What gaps are still obvious in this scope?",
    ],
    MAX_SUGGESTED_QUESTIONS
  )

  const summaryParts = [
    `${resourceCount} resource(s) in scope`,
    categoryCounts.length > 0
      ? `${categoryCounts.length} category bucket(s)`
      : "no category structure yet",
    topCategories.length > 0
      ? `strongest areas: ${topCategories.join(", ")}`
      : "needs clearer focus areas",
  ]

  return {
    summary: summaryParts.join("; "),
    focusAreas,
    gaps: uniqueValues(gaps, MAX_GAPS),
    suggestedQuestions,
    resourceCount,
    usedAi: false,
    model: null,
    warning: null,
  }
}

function buildResourceDigest(resources: ResourceCard[]): string {
  return resources
    .slice(0, MAX_DIGEST_RESOURCES)
    .map((resource, index) => {
      const firstLink = resource.links[0]
      const parts = [
        `${index + 1}. category=${resource.category}`,
        resource.tags.length > 0 ? `tags=${resource.tags.join(", ")}` : "",
        firstLink?.label ? `label=${normalizeWhitespace(firstLink.label).slice(0, 120)}` : "",
        firstLink?.note
          ? `note=${normalizeWhitespace(firstLink.note).slice(0, 140)}`
          : "",
        firstLink?.url ? `url=${firstLink.url}` : "",
      ].filter(Boolean)

      return parts.join(" | ")
    })
    .join("\n")
}

function parseBriefResponse(text: string): Pick<
  LibraryBriefResult,
  "summary" | "focusAreas" | "gaps" | "suggestedQuestions"
> | null {
  const trimmed = text.trim()
  if (!trimmed) {
    return null
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      summary?: unknown
      focusAreas?: unknown
      gaps?: unknown
      suggestedQuestions?: unknown
    }

    if (typeof parsed.summary !== "string" || !normalizeWhitespace(parsed.summary)) {
      return null
    }

    return {
      summary: normalizeWhitespace(parsed.summary).slice(0, 260),
      focusAreas: uniqueValues(
        Array.isArray(parsed.focusAreas)
          ? parsed.focusAreas.filter((value): value is string => typeof value === "string")
          : [],
        MAX_FOCUS_AREAS
      ),
      gaps: uniqueValues(
        Array.isArray(parsed.gaps)
          ? parsed.gaps.filter((value): value is string => typeof value === "string")
          : [],
        MAX_GAPS
      ),
      suggestedQuestions: uniqueValues(
        Array.isArray(parsed.suggestedQuestions)
          ? parsed.suggestedQuestions.filter(
              (value): value is string => typeof value === "string"
            )
          : [],
        MAX_SUGGESTED_QUESTIONS
      ),
    }
  } catch {
    return null
  }
}

async function generateAiBrief(
  resources: ResourceCard[]
): Promise<Pick<LibraryBriefResult, "summary" | "focusAreas" | "gaps" | "suggestedQuestions" | "model">> {
  const aiResult = await generateAiText({
    systemInstruction: [
      "You create scope briefs for a saved developer-resource library.",
      "Return JSON only with shape: {\"summary\":\"...\",\"focusAreas\":[\"...\"],\"gaps\":[\"...\"],\"suggestedQuestions\":[\"...\"]}.",
      "Summary max 220 chars.",
      "focusAreas: 2-4 concise themes.",
      "gaps: 1-4 concrete weaknesses or cleanup opportunities.",
      "suggestedQuestions: 2-4 specific follow-up questions the user should ask next.",
      "Stay grounded in the provided resources and do not invent sources.",
    ].join(" "),
    prompt: [
      `Resource count: ${resources.length}`,
      "",
      "Resources:",
      buildResourceDigest(resources),
    ].join("\n"),
    temperature: 0.2,
    maxOutputTokens: 600,
    responseMimeType: "application/json",
  })

  const parsed = parseBriefResponse(aiResult.text)
  if (!parsed) {
    throw new Error("AI did not return a usable scope brief.")
  }

  return {
    ...parsed,
    model: aiResult.model,
  }
}

export async function generateLibraryBrief(
  input: GenerateLibraryBriefInput
): Promise<LibraryBriefResult> {
  const resources = input.resources
  const fallback = buildFallbackBrief(resources)

  if (!input.useAi || resources.length === 0) {
    return fallback
  }

  try {
    const aiResult = await generateAiBrief(resources)
    return {
      summary: aiResult.summary,
      focusAreas: aiResult.focusAreas,
      gaps: aiResult.gaps,
      suggestedQuestions: aiResult.suggestedQuestions,
      resourceCount: resources.length,
      usedAi: true,
      model: aiResult.model,
      warning: null,
    }
  } catch (error) {
    return {
      ...fallback,
      warning:
        error instanceof Error
          ? error.message
          : "AI scope brief failed; fallback brief was returned.",
    }
  }
}
