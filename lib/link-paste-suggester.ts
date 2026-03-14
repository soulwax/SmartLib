import "server-only"

import { generateAiText } from "@/lib/ai-provider"
import {
  buildLinkDraftFromUrl,
  normalizeDraftCategory,
  normalizeDraftLabel,
  normalizeDraftNote,
  normalizeDraftTags,
} from "@/lib/link-paste"

const PAGE_FETCH_TIMEOUT_MS = 8000
const MAX_PAGE_SIZE_BYTES = 2 * 1024 * 1024 // 2MB

// Blocklist for spam/scam/low-quality tags
const TAG_BLOCKLIST = new Set([
  "buy", "sale", "discount", "cheap", "free", "money", "earn",
  "casino", "poker", "betting", "crypto", "nft", "investment",
  "weight loss", "miracle", "guaranteed", "revolutionary",
  "php", "wordpress", "drupal", // Don't hallucinate tech stacks
  "laravel", "symfony", // unless actually detected
])

// Technology detection patterns
const TECH_PATTERNS = {
  react: /_app|react\.development|react\.production|__NEXT_DATA__|_buildManifest/i,
  nextjs: /__NEXT_DATA__|_buildManifest\.js|_next\/static/i,
  vue: /vue\.js|vue\.runtime|createApp|__VUE__/i,
  angular: /ng-version|angular\.min\.js|platformBrowserDynamic/i,
  svelte: /svelte|__svelte__/i,
  gatsby: /___gatsby|gatsby-/i,
  astro: /astro-island|data-astro/i,
}

interface PageMetadata {
  title: string | null
  description: string | null
  ogTitle: string | null
  ogDescription: string | null
  twitterDescription: string | null
  detectedTechs: string[]
  htmlSnippet: string
}

interface SuggestLinkDetailsInput {
  url: string
  categories?: string[]
}

/**
 * Fetch and analyze the actual page content to extract real metadata.
 * This prevents AI hallucinations by providing ground truth.
 */
async function fetchPageMetadata(url: string): Promise<PageMetadata> {
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LinkAnalyzer/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    })

    if (!response.ok) {
      console.warn(`[link-suggester] Failed to fetch ${url}: ${response.status}`)
      return {
        title: null,
        description: null,
        ogTitle: null,
        ogDescription: null,
        twitterDescription: null,
        detectedTechs: [],
        htmlSnippet: "",
      }
    }

    const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10)
    if (Number.isFinite(contentLength) && contentLength > MAX_PAGE_SIZE_BYTES) {
      console.warn(`[link-suggester] Page too large: ${contentLength} bytes`)
      return {
        title: null,
        description: null,
        ogTitle: null,
        ogDescription: null,
        twitterDescription: null,
        detectedTechs: [],
        htmlSnippet: "",
      }
    }

    const html = await response.text()

    // Extract metadata from HTML
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const title = titleMatch?.[1]?.trim() || null

    const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)
    const description = descMatch?.[1]?.trim() || null

    const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)
    const ogTitle = ogTitleMatch?.[1]?.trim() || null

    const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i)
    const ogDescription = ogDescMatch?.[1]?.trim() || null

    const twitterDescMatch = html.match(/<meta\s+name=["']twitter:description["']\s+content=["']([^"']+)["']/i)
    const twitterDescription = twitterDescMatch?.[1]?.trim() || null

    // Detect technologies
    const detectedTechs: string[] = []
    for (const [tech, pattern] of Object.entries(TECH_PATTERNS)) {
      if (pattern.test(html)) {
        detectedTechs.push(tech)
      }
    }

    // Get a snippet of text content (first 500 chars of visible text)
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
    const bodyHtml = bodyMatch?.[1] || html.substring(0, 5000)
    const textContent = bodyHtml
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 500)

    return {
      title,
      description,
      ogTitle,
      ogDescription,
      twitterDescription,
      detectedTechs,
      htmlSnippet: textContent,
    }
  } catch (error) {
    console.error(`[link-suggester] Error fetching page metadata:`, error)
    return {
      title: null,
      description: null,
      ogTitle: null,
      ogDescription: null,
      twitterDescription: null,
      detectedTechs: [],
      htmlSnippet: "",
    }
  }
}

/**
 * Filter out spam/scam/low-quality tags
 */
function filterTags(tags: string[]): string[] {
  return tags.filter((tag) => {
    const normalized = tag.toLowerCase()
    // Check against blocklist
    for (const blocked of TAG_BLOCKLIST) {
      if (normalized.includes(blocked)) {
        console.warn(`[link-suggester] Blocked tag: ${tag}`)
        return false
      }
    }
    return true
  })
}

function parseSuggestionFromText(text: string): {
  label: string | null
  note: string | null
  category: string | null
  tags: string[]
} {
  const trimmed = text.trim()
  if (!trimmed) {
    return { label: null, note: null, category: null, tags: [] }
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      label?: unknown
      note?: unknown
      description?: unknown
      category?: unknown
      tags?: unknown
    }
    const label =
      typeof parsed.label === "string" ? normalizeDraftLabel(parsed.label) : null
    const noteValue =
      typeof parsed.note === "string"
        ? parsed.note
        : typeof parsed.description === "string"
          ? parsed.description
          : null
    const category =
      typeof parsed.category === "string"
        ? normalizeDraftCategory(parsed.category)
        : null
    const tags = normalizeDraftTags(
      Array.isArray(parsed.tags)
        ? parsed.tags.filter((item): item is string => typeof item === "string")
        : typeof parsed.tags === "string"
          ? parsed.tags
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean)
          : []
    )

    return {
      label,
      note: noteValue ? normalizeDraftNote(noteValue) : null,
      category,
      tags,
    }
  } catch {
    const labelMatch = trimmed.match(/"label"\s*:\s*"([^"]+)"/i)
    const noteMatch = trimmed.match(
      /"(?:note|description)"\s*:\s*"([^"]+)"/i
    )
    const categoryMatch = trimmed.match(/"category"\s*:\s*"([^"]+)"/i)
    const tagsMatch = trimmed.match(/"tags"\s*:\s*\[([^\]]*)\]/i)

    const tags =
      tagsMatch?.[1]
        ?.split(",")
        .map((item) => item.replace(/^["'\s]+|["'\s]+$/g, ""))
        .filter(Boolean) ?? []

    return {
      label: labelMatch?.[1] ? normalizeDraftLabel(labelMatch[1]) : null,
      note: noteMatch?.[1] ? normalizeDraftNote(noteMatch[1]) : null,
      category: categoryMatch?.[1]
        ? normalizeDraftCategory(categoryMatch[1])
        : null,
      tags: normalizeDraftTags(tags),
    }
  }
}

export async function suggestLinkDetailsFromUrl(
  input: SuggestLinkDetailsInput
): Promise<{
  label: string
  note: string
  category: string | null
  tags: string[]
  model: string
}> {
  const fallback = buildLinkDraftFromUrl(input.url)
  const categoryHints = normalizeDraftTags(
    (input.categories ?? []).map((category) => category.trim())
  )
  const categoryHintText =
    categoryHints.length > 0
      ? `Existing categories: ${categoryHints.join(", ")}`
      : "No existing categories provided."

  // Fetch actual page content for ground truth
  console.log(`[link-suggester] Fetching page metadata for ${input.url}`)
  const pageData = await fetchPageMetadata(input.url)

  // Build factual context from actual page content
  const factualContext = [
    `URL: ${input.url}`,
    `Page Title: ${pageData.title || pageData.ogTitle || "(not found)"}`,
    `Meta Description: ${pageData.description || pageData.ogDescription || pageData.twitterDescription || "(not found)"}`,
    pageData.detectedTechs.length > 0
      ? `Detected Technologies: ${pageData.detectedTechs.join(", ")}`
      : null,
    pageData.htmlSnippet
      ? `Page Content Sample: ${pageData.htmlSnippet}`
      : null,
    categoryHintText,
  ]
    .filter(Boolean)
    .join("\n")

  const aiResult = await generateAiText({
    systemInstruction: [
      "You are a metadata assistant. CRITICAL RULES:",
      "1. ONLY use information from the actual page content provided",
      "2. DO NOT invent or hallucinate technologies, features, or descriptions",
      "3. If page metadata is missing, use URL-based fallback",
      "4. Return ONLY valid JSON: {\"label\":\"...\",\"note\":\"...\",\"category\":\"...\",\"tags\":[...]}",
      "5. Label: concise page title (max 120 chars)",
      "6. Note: factual one-sentence description from page content (max 280 chars)",
      "7. Category: broad category like 'Documentation', 'Tool', 'Tutorial' (1-3 words)",
      "8. Tags: 1-4 factual tags based on detected technologies or page purpose",
      "9. Avoid marketing language, superlatives, and promotional terms",
      "10. If detected technologies are listed, include relevant ones as tags",
    ].join("\n"),
    prompt: factualContext,
    temperature: 0.1,
    maxOutputTokens: 200,
    responseMimeType: "application/json",
  })
  const parsed = parseSuggestionFromText(aiResult.text)

  // Filter out spam/scam tags
  const filteredTags = filterTags(parsed.tags)

  // Use page title as label if AI didn't provide one
  const finalLabel =
    parsed.label ||
    pageData.title ||
    pageData.ogTitle ||
    fallback.label

  // Use page description as note if AI didn't provide one
  const finalNote =
    parsed.note ||
    pageData.description ||
    pageData.ogDescription ||
    pageData.twitterDescription ||
    fallback.note

  // Add detected technologies as tags if they're not already present
  const techTags = pageData.detectedTechs
    .filter((tech) => !filteredTags.some((t) => t.toLowerCase() === tech.toLowerCase()))
    .slice(0, 2) // Max 2 tech tags

  const finalTags = normalizeDraftTags([...filteredTags, ...techTags])

  console.log(`[link-suggester] Generated suggestions for ${input.url}:`, {
    label: finalLabel,
    detectedTechs: pageData.detectedTechs,
    tags: finalTags,
  })

  return {
    label: finalLabel,
    note: finalNote,
    category: parsed.category,
    tags: finalTags,
    model: aiResult.model,
  }
}
