import "server-only"

import {
  buildLinkDraftFromUrl,
  normalizeDraftCategory,
  normalizeDraftLabel,
  normalizeDraftNote,
  normalizeDraftTags,
} from "@/lib/link-paste"

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions"
const DEFAULT_PERPLEXITY_MODEL = "sonar"

export class MissingPerplexityApiKeyError extends Error {
  constructor() {
    super("AI features are unavailable because PERPLEXITY_API_KEY is not configured.")
    this.name = "MissingPerplexityApiKeyError"
  }
}

interface SuggestLinkDetailsInput {
  url: string
  categories?: string[]
}

function getPerplexityApiKey(): string {
  const apiKey = process.env.PERPLEXITY_API_KEY?.trim()
  if (!apiKey) {
    throw new MissingPerplexityApiKeyError()
  }

  return apiKey
}

function extractAssistantText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return ""
  }

  const root = payload as {
    choices?: Array<{ message?: { content?: unknown } }>
  }
  const content = root.choices?.[0]?.message?.content

  if (typeof content === "string") {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part
        }

        if (
          part &&
          typeof part === "object" &&
          "text" in part &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          return (part as { text: string }).text
        }

        return ""
      })
      .join("\n")
  }

  return ""
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
  const apiKey = getPerplexityApiKey()
  const fallback = buildLinkDraftFromUrl(input.url)
  const model = DEFAULT_PERPLEXITY_MODEL
  const categoryHints = normalizeDraftTags(
    (input.categories ?? []).map((category) => category.trim())
  )
  const categoryHintText =
    categoryHints.length > 0
      ? `Existing categories: ${categoryHints.join(", ")}`
      : "No existing categories provided."

  const response = await fetch(PERPLEXITY_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 180,
      messages: [
        {
          role: "system",
          content:
            "You are a metadata assistant for developer links. Return JSON only: {\"label\":\"...\",\"note\":\"...\",\"category\":\"...\",\"tags\":[\"...\"]}. Label: concise. Note: one sentence. Category: 1-3 words. Tags: 1-4 concise tags.",
        },
        {
          role: "user",
          content: [
            `URL: ${input.url}`,
            `Fallback label: ${fallback.label}`,
            `Fallback note: ${fallback.note || "(empty)"}`,
            categoryHintText,
            "Use plain text. Avoid quotes, emojis, and marketing language.",
          ].join("\n"),
        },
      ],
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error("[link-paste-suggester] Perplexity API error:", {
      status: response.status,
      statusText: response.statusText,
      body: errorText.substring(0, 500), // Log first 500 chars for debugging
    })

    // Don't expose ugly HTML errors to users
    if (response.status === 401) {
      throw new Error(
        "AI suggestions unavailable: API authentication failed. Please check your Perplexity API key."
      )
    }

    throw new Error(
      `AI suggestions unavailable (${response.status}): ${response.statusText || "Unknown error"}`
    )
  }

  const payload = (await response.json()) as unknown
  const assistantText = extractAssistantText(payload)
  const parsed = parseSuggestionFromText(assistantText)

  return {
    label: parsed.label ?? fallback.label,
    note: parsed.note ?? fallback.note,
    category: parsed.category,
    tags: parsed.tags,
    model,
  }
}
