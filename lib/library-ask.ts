import "server-only"

import { generateAiText } from "@/lib/ai-provider"
import type { ResourceCard, ResourceLink } from "@/lib/resources"

const MAX_QUESTION_LENGTH = 500
const DEFAULT_MAX_CITATIONS = 5
const MAX_CITATIONS = 8
const MAX_HISTORY_ITEMS = 8
const QUERY_CONTEXT_USER_TURN_COUNT = 2
const MAX_FOLLOW_UP_SUGGESTIONS = 4

export type AskLibraryMode = "concise" | "deep" | "actions"

export interface AskLibraryConversationTurn {
  role: "user" | "assistant"
  content: string
}

export interface AskLibraryCitation {
  index: number
  resourceId: string
  category: string
  tags: string[]
  linkUrl: string
  linkLabel: string
  linkNote: string | null
  score: number
  confidence: number
}

export interface AskLibraryReasoning {
  summary: string
  queryTokens: string[]
  primaryCategories: string[]
  averageConfidence: number
  confidenceLabel: "low" | "medium" | "high"
}

export interface AskLibraryResult {
  question: string
  answer: string
  citations: AskLibraryCitation[]
  reasoning: AskLibraryReasoning
  followUpSuggestions: string[]
  usedAi: boolean
  model: string | null
}

interface AskLibraryInput {
  question: string
  resources: ResourceCard[]
  maxCitations?: number
  useAi?: boolean
  mode?: AskLibraryMode
  history?: AskLibraryConversationTurn[]
}

interface ScoredMatch {
  resource: ResourceCard
  score: number
  bestLink: ResourceLink | null
  matchedTags: string[]
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeQuestion(value: string): string {
  return normalizeWhitespace(value).slice(0, MAX_QUESTION_LENGTH)
}

function normalizeConversationHistory(
  history: AskLibraryConversationTurn[] | undefined
): AskLibraryConversationTurn[] {
  if (!history || history.length === 0) {
    return []
  }

  return history
    .slice(-MAX_HISTORY_ITEMS)
    .map((turn) => ({
      role: turn.role,
      content: normalizeWhitespace(turn.content).slice(0, MAX_QUESTION_LENGTH),
    }))
    .filter((turn) => turn.content.length > 0)
}

function tokenizeQuestion(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9+.#-]+/)
        .map((part) => part.trim())
        .filter((part) => part.length >= 2)
    )
  )
}

function countTokenMatches(text: string, tokens: string[]): number {
  const haystack = text.toLowerCase()
  let matches = 0

  for (const token of tokens) {
    if (haystack.includes(token)) {
      matches += 1
    }
  }

  return matches
}

function scoreLink(link: ResourceLink, tokens: string[]): number {
  const labelScore = countTokenMatches(link.label, tokens) * 5
  const noteScore = countTokenMatches(link.note ?? "", tokens) * 3
  const urlScore = countTokenMatches(link.url, tokens) * 2

  return labelScore + noteScore + urlScore
}

function scoreResource(resource: ResourceCard, tokens: string[]): ScoredMatch | null {
  if (tokens.length === 0) {
    return null
  }

  const categoryScore = countTokenMatches(resource.category, tokens) * 6
  const tagScore = resource.tags.reduce((acc, tag) => {
    return acc + countTokenMatches(tag, tokens) * 4
  }, 0)

  let bestLink: ResourceLink | null = null
  let bestLinkScore = 0
  let linkScore = 0

  for (const link of resource.links) {
    const nextScore = scoreLink(link, tokens)
    if (nextScore <= 0) {
      continue
    }

    linkScore += Math.min(nextScore, 12)
    if (nextScore > bestLinkScore) {
      bestLinkScore = nextScore
      bestLink = link
    }
  }

  const totalScore = categoryScore + tagScore + linkScore
  if (totalScore <= 0) {
    return null
  }

  const matchedTags = resource.tags.filter((tag) =>
    tokens.some((token) => tag.toLowerCase().includes(token))
  )

  return {
    resource,
    score: totalScore,
    bestLink,
    matchedTags,
  }
}

function buildQueryContext(question: string, history: AskLibraryConversationTurn[]): string {
  const recentUserTurns = history
    .filter((turn) => turn.role === "user")
    .slice(-QUERY_CONTEXT_USER_TURN_COUNT)
    .map((turn) => turn.content)

  return normalizeWhitespace([question, ...recentUserTurns].filter(Boolean).join(" "))
}

function calculateCitationConfidence(score: number, topScore: number): number {
  if (topScore <= 0) {
    return 0
  }

  return Math.max(1, Math.min(100, Math.round((score / topScore) * 100)))
}

function toCitations(matches: ScoredMatch[], maxCitations: number): AskLibraryCitation[] {
  const topScore = matches[0]?.score ?? 0

  return matches.slice(0, maxCitations).map((match, index) => {
    const link = match.bestLink ?? match.resource.links[0] ?? null

    return {
      index: index + 1,
      resourceId: match.resource.id,
      category: match.resource.category,
      tags: match.matchedTags.slice(0, 6),
      linkUrl: link?.url ?? "",
      linkLabel: link?.label ?? "Resource",
      linkNote: link?.note ?? null,
      score: match.score,
      confidence: calculateCitationConfidence(match.score, topScore),
    }
  })
}

function buildReasoning(
  question: string,
  queryTokens: string[],
  citations: AskLibraryCitation[]
): AskLibraryReasoning {
  if (citations.length === 0) {
    return {
      summary:
        "No relevant citations were found in the current scope. Try broadening your filters or question.",
      queryTokens: queryTokens.slice(0, 8),
      primaryCategories: [],
      averageConfidence: 0,
      confidenceLabel: "low",
    }
  }

  const categories = Array.from(new Set(citations.map((citation) => citation.category))).slice(
    0,
    3
  )
  const averageConfidence = Math.round(
    citations.reduce((acc, citation) => acc + citation.confidence, 0) /
      citations.length
  )
  const confidenceLabel =
    averageConfidence >= 75 ? "high" : averageConfidence >= 45 ? "medium" : "low"

  return {
    summary: [
      `Matched "${question}" using ${citations.length} citation${citations.length === 1 ? "" : "s"}.`,
      categories.length > 0 ? `Top categories: ${categories.join(", ")}.` : "",
      `Confidence: ${confidenceLabel} (${averageConfidence}%).`,
    ]
      .filter(Boolean)
      .join(" "),
    queryTokens: queryTokens.slice(0, 8),
    primaryCategories: categories,
    averageConfidence,
    confidenceLabel,
  }
}

function uniqueSuggestions(values: string[]): string[] {
  const deduped = new Map<string, string>()
  for (const value of values) {
    const normalized = normalizeWhitespace(value).slice(0, 200)
    if (!normalized) {
      continue
    }

    const key = normalized.toLowerCase()
    if (!deduped.has(key)) {
      deduped.set(key, normalized)
    }
  }

  return [...deduped.values()].slice(0, MAX_FOLLOW_UP_SUGGESTIONS)
}

function buildFollowUpSuggestions(
  question: string,
  citations: AskLibraryCitation[],
  reasoning: AskLibraryReasoning,
  hasHistory: boolean
): string[] {
  if (citations.length === 0) {
    const primaryToken = reasoning.queryTokens[0] ?? "this topic"
    return uniqueSuggestions([
      `Can you search broader sources about ${primaryToken}?`,
      "Which category should I explore first for this question?",
      "What keywords should I try to find better matches?",
    ])
  }

  const topCitation = citations[0]
  const topTag = topCitation?.tags[0]
  const secondaryCitation = citations[1]

  return uniqueSuggestions([
    `Can you summarize key takeaways from [${topCitation.index}] ${topCitation.linkLabel}?`,
    topTag
      ? `What else in ${topCitation.category} covers ${topTag}?`
      : `What else in ${topCitation.category} is most relevant here?`,
    secondaryCitation
      ? `Compare [${topCitation.index}] and [${secondaryCitation.index}] for tradeoffs.`
      : `What should I read next after [${topCitation.index}]?`,
    hasHistory
      ? `Given our thread, what is the next best action for "${question}"?`
      : `What should I ask next to narrow this down further?`,
  ])
}

function buildDeterministicAnswer(
  question: string,
  citations: AskLibraryCitation[],
  hasHistory: boolean
): string {
  if (citations.length === 0) {
    return "I couldn't find relevant matches in this scope. Try a broader question or remove filters."
  }

  const categories = Array.from(new Set(citations.map((citation) => citation.category)))
  const categoryText = categories.slice(0, 3).join(", ")

  const topReferences = citations
    .slice(0, 3)
    .map((citation) => `[${citation.index}] ${citation.linkLabel}`)
    .join(", ")

  const contextPrefix = hasHistory ? "Using your recent follow-up context, " : ""

  return [
    `${contextPrefix}for "${question}", I found ${citations.length} relevant match${citations.length === 1 ? "" : "es"}${categoryText ? ` in ${categoryText}` : ""}.`,
    `Start with ${topReferences}.`,
  ].join(" ")
}

function buildAskLibrarySystemInstruction(mode: AskLibraryMode): string {
  const sharedRules = [
    "You are a retrieval assistant for a developer's saved library.",
    "Answer only from provided citations.",
    "Every factual sentence must include a citation marker like [1].",
    "Never invent facts, links, or sources.",
  ]

  if (mode === "deep") {
    return [
      ...sharedRules,
      "Prefer a fuller explanation with patterns, tradeoffs, and concrete takeaways.",
      "Keep the answer well-structured but compact enough to scan quickly.",
    ].join(" ")
  }

  if (mode === "actions") {
    return [
      ...sharedRules,
      "Respond as a practical action plan.",
      "Use short bullets or short paragraphs that recommend what to read or do next.",
    ].join(" ")
  }

  return [
    ...sharedRules,
    "Respond concisely in one or two tight paragraphs.",
  ].join(" ")
}

async function generateAiAnswer(
  question: string,
  citations: AskLibraryCitation[],
  history: AskLibraryConversationTurn[],
  mode: AskLibraryMode
): Promise<{ answer: string; model: string }> {
  const citationDigest = citations
    .map((citation) => {
      const details = [
        `[${citation.index}]`,
        `category=${citation.category}`,
        citation.tags.length > 0 ? `tags=${citation.tags.join(", ")}` : "",
        `label=${citation.linkLabel}`,
        citation.linkNote ? `note=${citation.linkNote}` : "",
        `url=${citation.linkUrl}`,
      ]
        .filter(Boolean)
        .join(" | ")

      return details
    })
    .join("\n")

  const conversationDigest =
    history.length > 0
      ? history
          .map((turn, index) => {
            const speaker = turn.role === "user" ? "User" : "Assistant"
            return `${speaker} ${index + 1}: ${turn.content}`
          })
          .join("\n")
      : ""

  const aiResult = await generateAiText({
    systemInstruction: buildAskLibrarySystemInstruction(mode),
    prompt: [
      `Question: ${question}`,
      `Answer mode: ${mode}`,
      ...(conversationDigest
        ? ["", "Recent conversation:", conversationDigest]
        : []),
      "",
      "Citations:",
      citationDigest,
    ].join("\n"),
    temperature: 0.2,
    maxOutputTokens: 350,
  })
  const assistantText = normalizeWhitespace(aiResult.text)
  if (!assistantText) {
    throw new Error("AI answer was empty.")
  }

  return {
    answer: assistantText,
    model: aiResult.model,
  }
}

export async function askLibraryQuestion(
  input: AskLibraryInput
): Promise<AskLibraryResult> {
  const question = normalizeQuestion(input.question)
  const history = normalizeConversationHistory(input.history)
  const mode = input.mode ?? "concise"
  const maxCitations = Math.min(
    MAX_CITATIONS,
    Math.max(1, input.maxCitations ?? DEFAULT_MAX_CITATIONS)
  )

  const queryContext = buildQueryContext(question, history)
  const tokens = tokenizeQuestion(queryContext)
  const scoredMatches = input.resources
    .map((resource) => scoreResource(resource, tokens))
    .filter((item): item is ScoredMatch => item !== null)
    .sort((left, right) => right.score - left.score)

  const citations = toCitations(scoredMatches, maxCitations).filter(
    (citation) => citation.linkUrl.trim().length > 0
  )
  const reasoning = buildReasoning(question, tokens, citations)
  const followUpSuggestions = buildFollowUpSuggestions(
    question,
    citations,
    reasoning,
    history.length > 0
  )

  if (citations.length === 0) {
    return {
      question,
      answer: buildDeterministicAnswer(question, citations, history.length > 0),
      citations,
      reasoning,
      followUpSuggestions,
      usedAi: false,
      model: null,
    }
  }

  if (input.useAi) {
    try {
      const aiResult = await generateAiAnswer(question, citations, history, mode)
      return {
        question,
        answer: aiResult.answer,
        citations,
        reasoning,
        followUpSuggestions,
        usedAi: true,
        model: aiResult.model,
      }
    } catch {
      // Fall through to deterministic answer.
    }
  }

  return {
    question,
    answer: buildDeterministicAnswer(question, citations, history.length > 0),
    citations,
    reasoning,
    followUpSuggestions,
    usedAi: false,
    model: null,
  }
}
