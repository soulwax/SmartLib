import "server-only"

import geminiConfig from "@/gemini.json"

export type AiProviderName = "gemini" | "perplexity"

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"
const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions"
const DEFAULT_PERPLEXITY_MODEL = "sonar"

function getGeminiModel(): string {
  const configuredModel =
    typeof geminiConfig.model === "string" ? geminiConfig.model.trim() : ""

  return configuredModel || "gemini-2.5-flash"
}

export class MissingAiApiKeyError extends Error {
  constructor() {
    super("AI features are unavailable because no AI API key is configured.")
    this.name = "MissingAiApiKeyError"
  }
}

interface GenerateAiTextInput {
  systemInstruction?: string
  prompt: string
  temperature?: number
  maxOutputTokens?: number
  responseMimeType?: "text/plain" | "application/json"
}

interface GenerateAiTextResult {
  text: string
  model: string
  provider: AiProviderName
}

type ProviderConfig =
  | {
      provider: "gemini"
      apiKey: string
      model: string
    }
  | {
      provider: "perplexity"
      apiKey: string
      model: string
    }

function getProviderConfig(): ProviderConfig {
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim()
  if (geminiApiKey) {
    return {
      provider: "gemini",
      apiKey: geminiApiKey,
      model: getGeminiModel(),
    }
  }

  const perplexityApiKey = process.env.PERPLEXITY_API_KEY?.trim()
  if (perplexityApiKey) {
    return {
      provider: "perplexity",
      apiKey: perplexityApiKey,
      model: process.env.PERPLEXITY_MODEL?.trim() || DEFAULT_PERPLEXITY_MODEL,
    }
  }

  throw new MissingAiApiKeyError()
}

function extractGeminiText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return ""
  }

  const root = payload as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: unknown }>
      }
    }>
  }

  return (
    root.candidates?.[0]?.content?.parts
      ?.map((part) => (typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n") ?? ""
  )
}

function extractPerplexityText(payload: unknown): string {
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

function extractApiErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return null
  }

  const errorValue = (payload as { error?: unknown }).error
  if (typeof errorValue === "string") {
    return errorValue
  }

  if (errorValue && typeof errorValue === "object") {
    const message = (errorValue as { message?: unknown }).message
    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim()
    }
  }

  return null
}

async function readApiErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as unknown
    return (
      extractApiErrorMessage(payload) ||
      JSON.stringify(payload).slice(0, 500) ||
      "No response body."
    )
  } catch {
    try {
      const text = await response.text()
      return text || "No response body."
    } catch {
      return "No response body."
    }
  }
}

async function generateWithGemini(
  config: Extract<ProviderConfig, { provider: "gemini" }>,
  input: GenerateAiTextInput
): Promise<GenerateAiTextResult> {
  const response = await fetch(
    `${GEMINI_API_BASE_URL}/${encodeURIComponent(config.model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": config.apiKey,
      },
      body: JSON.stringify({
        system_instruction: input.systemInstruction
          ? {
              parts: [{ text: input.systemInstruction }],
            }
          : undefined,
        contents: [
          {
            role: "user",
            parts: [{ text: input.prompt }],
          },
        ],
        generationConfig: {
          temperature: input.temperature,
          maxOutputTokens: input.maxOutputTokens,
          responseMimeType: input.responseMimeType,
        },
      }),
    }
  )

  if (!response.ok) {
    const errorText = await readApiErrorMessage(response)
    throw new Error(
      `AI provider request failed (${response.status}). ${errorText || "No response body."}`
    )
  }

  const payload = (await response.json()) as unknown
  const text = extractGeminiText(payload).trim()
  if (!text) {
    throw new Error("AI provider returned an empty response.")
  }

  return {
    text,
    model: config.model,
    provider: config.provider,
  }
}

async function generateWithPerplexity(
  config: Extract<ProviderConfig, { provider: "perplexity" }>,
  input: GenerateAiTextInput
): Promise<GenerateAiTextResult> {
  const response = await fetch(PERPLEXITY_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      temperature: input.temperature,
      max_tokens: input.maxOutputTokens,
      messages: [
        ...(input.systemInstruction
          ? [
              {
                role: "system",
                content: input.systemInstruction,
              },
            ]
          : []),
        {
          role: "user",
          content: input.prompt,
        },
      ],
    }),
  })

  if (!response.ok) {
    const errorText = await readApiErrorMessage(response)
    throw new Error(
      `AI provider request failed (${response.status}). ${errorText || "No response body."}`
    )
  }

  const payload = (await response.json()) as unknown
  const text = extractPerplexityText(payload).trim()
  if (!text) {
    throw new Error("AI provider returned an empty response.")
  }

  return {
    text,
    model: config.model,
    provider: config.provider,
  }
}

export async function generateAiText(
  input: GenerateAiTextInput
): Promise<GenerateAiTextResult> {
  const config = getProviderConfig()
  if (config.provider === "gemini") {
    return generateWithGemini(config, input)
  }

  return generateWithPerplexity(config, input)
}
