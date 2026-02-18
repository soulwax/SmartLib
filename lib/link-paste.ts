export interface PastedLinkDraft {
  url: string
  label: string
  note: string
}

const MAX_LABEL_LENGTH = 120
const MAX_NOTE_LENGTH = 280

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return value.slice(0, maxLength).trim()
}

function sanitizeHostname(hostname: string): string {
  return hostname.replace(/^www\./i, "")
}

function sanitizePathSegment(segment: string): string {
  const normalized = normalizeWhitespace(segment.replace(/[-_]+/g, " "))
  if (!normalized) {
    return ""
  }

  return normalized
    .split(" ")
    .slice(0, 3)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ")
}

export function normalizeHttpUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null
    }

    return parsed.toString()
  } catch {
    return null
  }
}

export function buildLinkDraftFromUrl(url: string): PastedLinkDraft {
  const normalizedUrl = normalizeHttpUrl(url) ?? url.trim()

  try {
    const parsed = new URL(normalizedUrl)
    const hostname = sanitizeHostname(parsed.hostname)
    const firstPathSegment = parsed.pathname
      .split("/")
      .map((segment) => segment.trim())
      .find((segment) => segment.length > 0)
    const cleanedSegment = firstPathSegment
      ? sanitizePathSegment(firstPathSegment)
      : ""

    const labelBase = cleanedSegment ? `${hostname} ${cleanedSegment}` : hostname
    const label =
      truncate(normalizeWhitespace(labelBase), MAX_LABEL_LENGTH) || "Pasted link"

    const noteBase = `${hostname}${parsed.pathname}${parsed.search}`
    const note = truncate(normalizeWhitespace(noteBase), MAX_NOTE_LENGTH)

    return {
      url: parsed.toString(),
      label,
      note,
    }
  } catch {
    return {
      url: normalizedUrl,
      label: "Pasted link",
      note: "",
    }
  }
}

export function normalizeDraftLabel(value: string): string {
  const normalized = truncate(normalizeWhitespace(value), MAX_LABEL_LENGTH)
  return normalized || "Pasted link"
}

export function normalizeDraftNote(value: string): string {
  return truncate(normalizeWhitespace(value), MAX_NOTE_LENGTH)
}
