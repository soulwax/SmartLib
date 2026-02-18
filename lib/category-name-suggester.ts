import "server-only"

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions"
const DEFAULT_PERPLEXITY_MODEL = "sonar"
const MAX_LINK_SAMPLES = 64
const MAX_SUGGESTED_NAME_LENGTH = 80

interface LinkForCategorySuggestion {
  url: string
  label?: string | null
  note?: string | null
}

interface SuggestCategoryNameInput {
  currentName: string
  links: LinkForCategorySuggestion[]
}

export class MissingPerplexityApiKeyError extends Error {
  constructor() {
    super("AI features are unavailable because PERPLEXITY_API_KEY is not configured.")
    this.name = "MissingPerplexityApiKeyError"
  }
}

function getPerplexityApiKey(): string {
  const apiKey = process.env.PERPLEXITY_API_KEY?.trim()
  if (!apiKey) {
    throw new MissingPerplexityApiKeyError()
  }

  return apiKey
}

function normalizeCategoryName(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .slice(0, MAX_SUGGESTED_NAME_LENGTH)
}

function parseHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "")
  } catch {
    return "unknown-host"
  }
}

function buildLinkDigest(links: LinkForCategorySuggestion[]): string {
  return links
    .slice(0, MAX_LINK_SAMPLES)
    .map((link, index) => {
      const hostname = parseHostname(link.url)
      const label = (link.label ?? "").replace(/\s+/g, " ").trim()
      const note = (link.note ?? "").replace(/\s+/g, " ").trim()
      const parts = [
        `${index + 1}. host=${hostname}`,
        label ? `label=${label}` : "",
        note ? `note=${note}` : "",
        `url=${link.url}`,
      ].filter(Boolean)

      return parts.join(" | ")
    })
    .join("\n")
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

function parseSuggestedNameFromText(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) {
    return null
  }

  try {
    const parsed = JSON.parse(trimmed) as { name?: unknown }
    if (typeof parsed.name === "string") {
      return normalizeCategoryName(parsed.name)
    }
  } catch {
    // fall through to regex/line parsing
  }

  const nameMatch = trimmed.match(/"name"\s*:\s*"([^"]+)"/i)
  if (nameMatch?.[1]) {
    return normalizeCategoryName(nameMatch[1])
  }

  const firstLine = trimmed.split("\n")[0] ?? ""
  return normalizeCategoryName(firstLine.replace(/^name\s*:\s*/i, ""))
}

export async function suggestShortCategoryNameFromLinks(
  input: SuggestCategoryNameInput
): Promise<{ suggestedName: string; model: string }> {
  const currentName = normalizeCategoryName(input.currentName)
  const links = input.links.filter((link) => Boolean(link.url?.trim()))
  if (links.length === 0) {
    throw new Error("No links available for category name analysis.")
  }

  const apiKey = getPerplexityApiKey()
  const model = DEFAULT_PERPLEXITY_MODEL
  const linkDigest = buildLinkDigest(links)

  const response = await fetch(PERPLEXITY_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 120,
      messages: [
        {
          role: "system",
          content:
            "You are a naming assistant for developer resource libraries. Return JSON only: {\"name\":\"...\"}. The name must be short (1-3 words), descriptive, and <= 28 characters.",
        },
        {
          role: "user",
          content: [
            `Current category name: ${currentName || "General"}`,
            "Analyze the links and propose a better short category name.",
            "Use title case and avoid generic names like Misc or Links.",
            "",
            "Links:",
            linkDigest,
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
  const parsedName = parseSuggestedNameFromText(assistantText)
  const suggestedName = normalizeCategoryName(parsedName ?? "")

  if (!suggestedName) {
    throw new Error("AI did not return a valid category name suggestion.")
  }

  return {
    suggestedName,
    model,
  }
}
