import "server-only"

import { generateAiText } from "@/lib/ai-provider"
import type { ResourceCard } from "@/lib/resources"

const MIN_CATEGORY_ITEMS = 4
const MAX_CATEGORY_ITEMS = 120
const MAX_GROUPS = 5
const MIN_GROUPS = 2

export interface SmartCategorySplitResource {
  resourceId: string
  label: string
  url: string
  note: string | null
  tags: string[]
}

export interface SmartCategorySplitGroup {
  key: string
  name: string
  reason: string | null
  resources: SmartCategorySplitResource[]
}

export interface SmartCategorySplitPreview {
  sourceCategoryName: string
  resourceCount: number
  groups: SmartCategorySplitGroup[]
  warnings: string[]
  usedAi: boolean
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeGroupName(value: string, fallback: string): string {
  const normalized = normalizeWhitespace(value)
    .replace(/^['"`]+|['"`]+$/g, "")
    .slice(0, 80)

  return normalized || fallback
}

function normalizeReason(value: string | null | undefined): string | null {
  const normalized = normalizeWhitespace(value ?? "").slice(0, 180)
  return normalized || null
}

function makeGroupKey(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)

  return normalized || "group"
}

function parseHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase()
  } catch {
    return "unknown-host"
  }
}

function toTitleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((token) => token[0].toUpperCase() + token.slice(1).toLowerCase())
    .join(" ")
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

function getResourceSummary(resource: ResourceCard): SmartCategorySplitResource {
  const firstLink = resource.links[0]

  return {
    resourceId: resource.id,
    label: firstLink?.label ?? "Untitled resource",
    url: firstLink?.url ?? "",
    note: firstLink?.note ?? null,
    tags: resource.tags.slice(0, 8),
  }
}

function buildResourceDigest(resources: ResourceCard[]): string {
  return resources
    .slice(0, MAX_CATEGORY_ITEMS)
    .map((resource, index) => {
      const summary = getResourceSummary(resource)
      const parts = [
        `${index + 1}. id=${summary.resourceId}`,
        `label=${normalizeWhitespace(summary.label).slice(0, 120)}`,
        summary.note ? `note=${normalizeWhitespace(summary.note).slice(0, 140)}` : "",
        summary.tags.length > 0 ? `tags=${summary.tags.join(", ")}` : "",
        summary.url ? `url=${summary.url}` : "",
      ].filter(Boolean)

      return parts.join(" | ")
    })
    .join("\n")
}

interface ParsedAiGroup {
  key: string
  name: string
  reason: string | null
  resourceIds: string[]
}

function parseAiGroups(text: string): ParsedAiGroup[] {
  const trimmed = text.trim()
  if (!trimmed) {
    return []
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      groups?: unknown
      categories?: unknown
    }
    const rawGroups = Array.isArray(parsed.groups)
      ? parsed.groups
      : Array.isArray(parsed.categories)
        ? parsed.categories
        : []

    return rawGroups
      .map((group, index) => {
        if (!group || typeof group !== "object") {
          return null
        }

        const candidate = group as {
          key?: unknown
          name?: unknown
          title?: unknown
          reason?: unknown
          rationale?: unknown
          itemIds?: unknown
          resourceIds?: unknown
        }

        const rawName =
          typeof candidate.name === "string"
            ? candidate.name
            : typeof candidate.title === "string"
              ? candidate.title
              : `Group ${index + 1}`

        const resourceIds = Array.isArray(candidate.itemIds)
          ? candidate.itemIds
          : Array.isArray(candidate.resourceIds)
            ? candidate.resourceIds
            : []

        return {
          key:
            typeof candidate.key === "string" && candidate.key.trim().length > 0
              ? makeGroupKey(candidate.key)
              : makeGroupKey(rawName),
          name: normalizeGroupName(rawName, `Group ${index + 1}`),
          reason: normalizeReason(
            typeof candidate.reason === "string"
              ? candidate.reason
              : typeof candidate.rationale === "string"
                ? candidate.rationale
                : null
          ),
          resourceIds: resourceIds.filter(
            (value): value is string => typeof value === "string"
          ),
        } satisfies ParsedAiGroup
      })
      .filter((group): group is ParsedAiGroup => group !== null)
  } catch {
    return []
  }
}

function finalizeGroups(
  groups: ParsedAiGroup[],
  resources: ResourceCard[],
  categoryName: string
): SmartCategorySplitGroup[] {
  const resourceMap = new Map(resources.map((resource) => [resource.id, resource]))
  const assigned = new Set<string>()
  const cleanedGroups = groups
    .map((group, index) => {
      const resourceIds = group.resourceIds.filter((resourceId) => {
        if (!resourceMap.has(resourceId) || assigned.has(resourceId)) {
          return false
        }

        assigned.add(resourceId)
        return true
      })

      return {
        key: group.key || `group-${index + 1}`,
        name: normalizeGroupName(group.name, `Group ${index + 1}`),
        reason: group.reason,
        resourceIds,
      }
    })
    .filter((group) => group.resourceIds.length > 0)

  const unassignedResourceIds = resources
    .map((resource) => resource.id)
    .filter((resourceId) => !assigned.has(resourceId))

  if (unassignedResourceIds.length > 0) {
    cleanedGroups.push({
      key: "general",
      name: "General",
      reason: "Items that did not clearly fit another bucket.",
      resourceIds: unassignedResourceIds,
    })
  }

  if (cleanedGroups.length > MAX_GROUPS) {
    const sorted = [...cleanedGroups].sort(
      (left, right) => right.resourceIds.length - left.resourceIds.length
    )
    const keep = sorted.slice(0, MAX_GROUPS - 1)
    const merged = sorted.slice(MAX_GROUPS - 1).flatMap((group) => group.resourceIds)
    keep.push({
      key: "general",
      name: "General",
      reason: "Smaller buckets merged into a broader catch-all group.",
      resourceIds: merged,
    })
    cleanedGroups.splice(0, cleanedGroups.length, ...keep)
  }

  const singletonIds = cleanedGroups
    .filter((group) => group.resourceIds.length === 1)
    .flatMap((group) => group.resourceIds)

  if (singletonIds.length > 0 && cleanedGroups.length > MIN_GROUPS) {
    const remaining = cleanedGroups.filter((group) => group.resourceIds.length > 1)
    const generalGroup = remaining.find((group) => group.name.toLowerCase() === "general")

    if (generalGroup) {
      generalGroup.resourceIds.push(...singletonIds)
    } else {
      remaining.push({
        key: "general",
        name: "General",
        reason: "Small one-off buckets merged to stay broad and useful.",
        resourceIds: singletonIds,
      })
    }

    cleanedGroups.splice(0, cleanedGroups.length, ...remaining)
  }

  if (cleanedGroups.length < MIN_GROUPS) {
    throw new Error(
      `Could not find a meaningful split for "${categoryName}". Try a broader category or add more items first.`
    )
  }

  const dedupedNames = new Map<string, number>()
  return cleanedGroups.map((group, index) => {
    const baseName = normalizeGroupName(group.name, `Group ${index + 1}`)
    const baseKey = baseName.toLowerCase()
    const nextCount = (dedupedNames.get(baseKey) ?? 0) + 1
    dedupedNames.set(baseKey, nextCount)
    const finalName =
      nextCount > 1 ? `${baseName} ${nextCount}`.slice(0, 80) : baseName

    return {
      key: makeGroupKey(`${group.key}-${index}`),
      name: finalName,
      reason: normalizeReason(group.reason),
      resources: group.resourceIds
        .map((resourceId) => resourceMap.get(resourceId))
        .filter((resource): resource is ResourceCard => Boolean(resource))
        .map(getResourceSummary),
    }
  })
}

function buildFallbackGroups(resources: ResourceCard[]): SmartCategorySplitGroup[] {
  const tagCounts = countValues(resources.flatMap((resource) => resource.tags))
    .filter(([, count]) => count >= 2)
    .slice(0, 3)

  if (tagCounts.length >= 2) {
    const groups = tagCounts.map(([tag]) => ({
      key: makeGroupKey(tag),
      name: normalizeGroupName(toTitleCase(tag), "General"),
      reason: `Grouped around the recurring tag "${tag}".`,
      resources: [] as SmartCategorySplitResource[],
    }))

    const generalResources: SmartCategorySplitResource[] = []
    for (const resource of resources) {
      const summary = getResourceSummary(resource)
      const matchingGroup = groups.find((group) =>
        resource.tags.some(
          (tag) => tag.toLowerCase() === group.name.toLowerCase() || tag.toLowerCase() === group.key
        )
      )

      if (matchingGroup) {
        matchingGroup.resources.push(summary)
      } else {
        generalResources.push(summary)
      }
    }

    const filtered = groups.filter((group) => group.resources.length > 0)
    if (generalResources.length > 0) {
      filtered.push({
        key: "general",
        name: "General",
        reason: "Items that did not fit the main recurring tags.",
        resources: generalResources,
      })
    }
    if (filtered.length >= MIN_GROUPS) {
      return filtered
    }
  }

  const hostCounts = countValues(
    resources.map((resource) => {
      const firstLink = resource.links[0]
      return firstLink ? parseHostname(firstLink.url) : "unknown-host"
    })
  )
    .filter(([, count]) => count >= 2)
    .slice(0, 3)

  if (hostCounts.length >= 2) {
    const groups = hostCounts.map(([host]) => ({
      key: makeGroupKey(host),
      name: normalizeGroupName(toTitleCase(host.split(".")[0] ?? host), "General"),
      reason: `Grouped around the recurring source ${host}.`,
      resources: [] as SmartCategorySplitResource[],
    }))

    const generalResources: SmartCategorySplitResource[] = []
    for (const resource of resources) {
      const summary = getResourceSummary(resource)
      const host = parseHostname(summary.url)
      const matchingGroup = groups.find((group) => makeGroupKey(host) === group.key)
      if (matchingGroup) {
        matchingGroup.resources.push(summary)
      } else {
        generalResources.push(summary)
      }
    }

    const filtered = groups.filter((group) => group.resources.length > 0)
    if (generalResources.length > 0) {
      filtered.push({
        key: "general",
        name: "General",
        reason: "Items that did not fit the main recurring sources.",
        resources: generalResources,
      })
    }
    if (filtered.length >= MIN_GROUPS) {
      return filtered
    }
  }

  throw new Error(
    "This category does not have enough clear structure to split automatically yet."
  )
}

async function generateAiGroups(
  categoryName: string,
  resources: ResourceCard[]
): Promise<ParsedAiGroup[]> {
  const aiResult = await generateAiText({
    systemInstruction: [
      "You reorganize one saved resource category into smart subcategories.",
      "Return JSON only with shape: {\"groups\":[{\"key\":\"...\",\"name\":\"...\",\"reason\":\"...\",\"itemIds\":[\"...\"]}]}",
      "Create 2 to 5 broad, useful subcategories.",
      "Do not create a category per item.",
      "Prefer buckets with at least 2 items when possible.",
      "Every item ID must appear exactly once.",
      "Keep names short, human, and general enough for future items.",
      "Avoid generic names unless needed for leftovers.",
    ].join(" "),
    prompt: [
      `Current category: ${categoryName}`,
      `Resource count: ${resources.length}`,
      "",
      "Resources:",
      buildResourceDigest(resources),
    ].join("\n"),
    temperature: 0.2,
    maxOutputTokens: 1200,
    responseMimeType: "application/json",
  })

  return parseAiGroups(aiResult.text)
}

export async function previewSmartCategorySplit(input: {
  categoryName: string
  resources: ResourceCard[]
}): Promise<SmartCategorySplitPreview> {
  const resources = input.resources.slice(0, MAX_CATEGORY_ITEMS)
  if (resources.length < MIN_CATEGORY_ITEMS) {
    throw new Error("Need at least 4 resources in a category before splitting it.")
  }

  const warnings: string[] = []

  try {
    const aiGroups = await generateAiGroups(input.categoryName, resources)
    return {
      sourceCategoryName: input.categoryName,
      resourceCount: resources.length,
      groups: finalizeGroups(aiGroups, resources, input.categoryName),
      warnings,
      usedAi: true,
    }
  } catch (error) {
    const fallbackGroups = buildFallbackGroups(resources)
    return {
      sourceCategoryName: input.categoryName,
      resourceCount: resources.length,
      groups: fallbackGroups,
      warnings: [
        error instanceof Error
          ? error.message
          : "AI split failed. Returned a heuristic preview instead.",
      ],
      usedAi: false,
    }
  }
}
