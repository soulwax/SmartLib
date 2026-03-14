import type { ResourceCard } from "@/lib/resources"

const TRACKING_QUERY_KEYS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "fbclid",
  "ref",
])

const EXACT_MATCH_LIMIT = 6
const NEAR_MATCH_LIMIT = 8

export type LinkDuplicateReason =
  | "exact-url"
  | "same-host-similar-path"
  | "similar-url"
  | "similar-label"

export interface LinkDuplicateMatch {
  resourceId: string
  workspaceId: string
  category: string
  linkUrl: string
  linkLabel: string
  reason: LinkDuplicateReason
  score: number
}

export interface LinkDuplicateInsight {
  url: string
  label: string
  exactMatches: LinkDuplicateMatch[]
  nearMatches: LinkDuplicateMatch[]
}

interface CandidateLink {
  url: string
  label: string
}

interface DuplicateDetectionInput {
  links: CandidateLink[]
  resources: ResourceCard[]
  workspaceId?: string | null
  excludeResourceId?: string | null
}

export interface DuplicateDetectionResult {
  exactMatches: LinkDuplicateMatch[]
  nearMatches: LinkDuplicateMatch[]
  insightsByLink: LinkDuplicateInsight[]
}

interface ParsedComparableUrl {
  key: string
  host: string
  pathTokens: Set<string>
  fullText: string
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2)
  )
}

function jaccardScore(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0
  }

  let intersection = 0
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1
    }
  }

  const union = left.size + right.size - intersection
  if (union <= 0) {
    return 0
  }

  return intersection / union
}

function diceCoefficient(left: string, right: string): number {
  if (!left || !right) {
    return 0
  }

  if (left === right) {
    return 1
  }

  if (left.length < 2 || right.length < 2) {
    return 0
  }

  const bigrams = new Map<string, number>()
  for (let index = 0; index < left.length - 1; index += 1) {
    const gram = left.slice(index, index + 2)
    bigrams.set(gram, (bigrams.get(gram) ?? 0) + 1)
  }

  let intersection = 0
  for (let index = 0; index < right.length - 1; index += 1) {
    const gram = right.slice(index, index + 2)
    const remaining = bigrams.get(gram) ?? 0
    if (remaining > 0) {
      intersection += 1
      bigrams.set(gram, remaining - 1)
    }
  }

  return (2 * intersection) / (left.length - 1 + (right.length - 1))
}

function parseComparableUrl(url: string): ParsedComparableUrl | null {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "")

    const normalizedPath =
      parsed.pathname === "/"
        ? "/"
        : parsed.pathname.replace(/\/+$/, "").toLowerCase()

    const params = [...parsed.searchParams.entries()]
      .filter(([key]) => !TRACKING_QUERY_KEYS.has(key.toLowerCase()))
      .map(([key, value]) => [key.toLowerCase(), value.trim()] as const)
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
        if (leftKey !== rightKey) {
          return leftKey.localeCompare(rightKey)
        }

        return leftValue.localeCompare(rightValue)
      })

    const normalizedQuery = params
      .map(([key, value]) => (value ? `${key}=${value}` : key))
      .join("&")

    const key = `${host}${normalizedPath}${normalizedQuery ? `?${normalizedQuery}` : ""}`
    const pathTokens = tokenize(`${host} ${normalizedPath} ${normalizedQuery}`)

    return {
      key,
      host,
      pathTokens,
      fullText: `${host}${normalizedPath}${normalizedQuery}`,
    }
  } catch {
    return null
  }
}

export function buildExactDuplicateKey(url: string): string | null {
  return parseComparableUrl(url)?.key ?? null
}

function compareLinkToExisting(
  input: CandidateLink,
  existing: { url: string; label: string }
): { reason: LinkDuplicateReason; score: number } | null {
  const parsedInputUrl = parseComparableUrl(input.url)
  const parsedExistingUrl = parseComparableUrl(existing.url)

  if (parsedInputUrl && parsedExistingUrl) {
    if (parsedInputUrl.key === parsedExistingUrl.key) {
      return { reason: "exact-url", score: 1 }
    }

    const sameHost = parsedInputUrl.host === parsedExistingUrl.host
    const pathSimilarity = jaccardScore(
      parsedInputUrl.pathTokens,
      parsedExistingUrl.pathTokens
    )

    if (sameHost && pathSimilarity >= 0.55) {
      return { reason: "same-host-similar-path", score: pathSimilarity }
    }

    const urlSimilarity = diceCoefficient(
      parsedInputUrl.fullText,
      parsedExistingUrl.fullText
    )
    if (urlSimilarity >= 0.82) {
      return { reason: "similar-url", score: urlSimilarity }
    }
  }

  const labelSimilarity = jaccardScore(
    tokenize(normalizeWhitespace(input.label)),
    tokenize(normalizeWhitespace(existing.label))
  )
  if (labelSimilarity >= 0.65) {
    return { reason: "similar-label", score: labelSimilarity }
  }

  return null
}

function dedupeMatches(matches: LinkDuplicateMatch[]): LinkDuplicateMatch[] {
  const byKey = new Map<string, LinkDuplicateMatch>()

  for (const match of matches) {
    const key = `${match.resourceId}|${match.linkUrl}`
    const existing = byKey.get(key)
    if (!existing || match.score > existing.score) {
      byKey.set(key, match)
    }
  }

  return [...byKey.values()].sort((left, right) => right.score - left.score)
}

function sliceMatchesByType(matches: LinkDuplicateMatch[]): {
  exactMatches: LinkDuplicateMatch[]
  nearMatches: LinkDuplicateMatch[]
} {
  const exactMatches = matches
    .filter((match) => match.reason === "exact-url")
    .slice(0, EXACT_MATCH_LIMIT)
  const nearMatches = matches
    .filter((match) => match.reason !== "exact-url")
    .slice(0, NEAR_MATCH_LIMIT)

  return {
    exactMatches,
    nearMatches,
  }
}

export function detectLinkDuplicates(input: DuplicateDetectionInput): DuplicateDetectionResult {
  const scopedResources = input.resources.filter((resource) => {
    if (input.workspaceId && resource.workspaceId !== input.workspaceId) {
      return false
    }

    if (input.excludeResourceId && resource.id === input.excludeResourceId) {
      return false
    }

    return true
  })

  const insightsByLink: LinkDuplicateInsight[] = []

  for (const link of input.links) {
    const normalizedUrl = normalizeWhitespace(link.url)
    if (!normalizedUrl) {
      continue
    }

    const normalizedLabel = normalizeWhitespace(link.label)
    const matches: LinkDuplicateMatch[] = []

    for (const resource of scopedResources) {
      for (const resourceLink of resource.links) {
        const similarity = compareLinkToExisting(
          {
            url: normalizedUrl,
            label: normalizedLabel,
          },
          {
            url: resourceLink.url,
            label: resourceLink.label,
          }
        )

        if (!similarity) {
          continue
        }

        matches.push({
          resourceId: resource.id,
          workspaceId: resource.workspaceId,
          category: resource.category,
          linkUrl: resourceLink.url,
          linkLabel: resourceLink.label,
          reason: similarity.reason,
          score: similarity.score,
        })
      }
    }

    const deduped = dedupeMatches(matches)
    const split = sliceMatchesByType(deduped)

    insightsByLink.push({
      url: normalizedUrl,
      label: normalizedLabel,
      exactMatches: split.exactMatches,
      nearMatches: split.nearMatches,
    })
  }

  const exactMatches = dedupeMatches(
    insightsByLink.flatMap((insight) => insight.exactMatches)
  ).slice(0, EXACT_MATCH_LIMIT)
  const nearMatches = dedupeMatches(
    insightsByLink.flatMap((insight) => insight.nearMatches)
  ).slice(0, NEAR_MATCH_LIMIT)

  return {
    exactMatches,
    nearMatches,
    insightsByLink,
  }
}
