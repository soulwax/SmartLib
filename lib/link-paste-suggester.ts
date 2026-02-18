import "server-only"

import {
  buildLinkDraftFromUrl,
  normalizeDraftLabel,
  normalizeDraftNote,
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
} {
  const trimmed = text.trim()
  if (!trimmed) {
    return { label: null, note: null }
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      label?: unknown
      note?: unknown
      description?: unknown
    }
    const label =
      typeof parsed.label === "string" ? normalizeDraftLabel(parsed.label) : null
    const noteValue =
      typeof parsed.note === "string"
        ? parsed.note
        : typeof parsed.description === "string"
          ? parsed.description
          : null

    return {
      label,
      note: noteValue ? normalizeDraftNote(noteValue) : null,
    }
  } catch {
    const labelMatch = trimmed.match(/"label"\s*:\s*"([^"]+)"/i)
    const noteMatch = trimmed.match(
      /"(?:note|description)"\s*:\s*"([^"]+)"/i
    )

    return {
      label: labelMatch?.[1] ? normalizeDraftLabel(labelMatch[1]) : null,
      note: noteMatch?.[1] ? normalizeDraftNote(noteMatch[1]) : null,
    }
  }
}

export async function suggestLinkDetailsFromUrl(
  input: SuggestLinkDetailsInput
): Promise<{ label: string; note: string; model: string }> {
  const apiKey = getPerplexityApiKey()
  const fallback = buildLinkDraftFromUrl(input.url)
  const model = DEFAULT_PERPLEXITY_MODEL

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
            "You are a metadata assistant for developer links. Return JSON only: {\"label\":\"...\",\"note\":\"...\"}. Label must be concise and descriptive. Note must be one short sentence.",
        },
        {
          role: "user",
          content: [
            `URL: ${input.url}`,
            `Fallback label: ${fallback.label}`,
            `Fallback note: ${fallback.note || "(empty)"}`,
            "Use plain text. Avoid quotes, emojis, and marketing language.",
          ].join("\n"),
        },
      ],
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `AI provider request failed (${response.status}). ${errorText || "No response body."}`
    )
  }

  const payload = (await response.json()) as unknown
  const assistantText = extractAssistantText(payload)
  const parsed = parseSuggestionFromText(assistantText)

  return {
    label: parsed.label ?? fallback.label,
    note: parsed.note ?? fallback.note,
    model,
  }
}
