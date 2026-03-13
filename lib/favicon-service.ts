import "server-only"

import { createHash } from "node:crypto"

const RESOLVE_TIMEOUT_MS = 5_000
const MAX_FAVICON_BYTES = 512 * 1024
const DEFAULT_FAVICON_SIZE = 64

// Color palette for generated favicons (Material Design inspired)
const FALLBACK_COLORS = [
  "#1976D2", // Blue
  "#388E3C", // Green
  "#D32F2F", // Red
  "#7B1FA2", // Purple
  "#F57C00", // Orange
  "#0097A7", // Cyan
  "#C2185B", // Pink
  "#5D4037", // Brown
  "#455A64", // Blue Grey
  "#E64A19", // Deep Orange
]

export interface ResolvedFaviconPayload {
  sourceUrl: string
  contentType: string
  contentBase64: string
  contentHash: string
  etag: string | null
  lastModified: string | null
}

export interface FaviconRevalidationState {
  sourceUrl?: string | null
  etag?: string | null
  lastModified?: string | null
}

export type RevalidatedFaviconResult =
  | {
      status: "modified"
      favicon: ResolvedFaviconPayload
    }
  | {
      status: "not-modified"
      sourceUrl: string
      etag: string | null
      lastModified: string | null
    }

type FaviconFetchResult =
  | {
      status: "modified"
      responseUrl: string
      contentType: string
      contentBase64: string
      contentHash: string
      etag: string | null
      lastModified: string | null
    }
  | {
      status: "not-modified"
      responseUrl: string
      etag: string | null
      lastModified: string | null
    }

export function hostnameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.hostname || null
  } catch {
    return null
  }
}

export function uniqueHostnames(urls: string[]): string[] {
  const seen = new Set<string>()
  for (const url of urls) {
    const h = hostnameFromUrl(url)
    if (h) seen.add(h)
  }
  return [...seen]
}

function normalizeCacheHeader(value: string | null): string | null {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }

  return trimmed.slice(0, 1024)
}

/**
 * Generate a fallback SVG favicon based on the hostname.
 * Uses the first 1-2 letters and a consistent color derived from the hostname.
 */
function generateFallbackFavicon(hostname: string): ResolvedFaviconPayload {
  const normalized = hostname.trim().toLowerCase()

  // Extract domain name without TLD for better initials
  const parts = normalized.split(".")
  const domain = parts.length > 1 ? parts[parts.length - 2] : parts[0]

  // Get initials (first 2 letters or first letter if short)
  const initials = domain.length > 1
    ? domain.substring(0, 2).toUpperCase()
    : domain.substring(0, 1).toUpperCase()

  // Generate consistent color from hostname hash
  const hash = createHash("md5").update(normalized).digest("hex")
  const colorIndex = parseInt(hash.substring(0, 2), 16) % FALLBACK_COLORS.length
  const bgColor = FALLBACK_COLORS[colorIndex]

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="${bgColor}" rx="8"/>
  <text x="32" y="32" text-anchor="middle" dominant-baseline="central"
        font-family="system-ui, -apple-system, sans-serif"
        font-size="28" font-weight="600" fill="white">${initials}</text>
</svg>`

  const buffer = Buffer.from(svg, "utf-8")

  return {
    sourceUrl: `generated:${normalized}`,
    contentType: "image/svg+xml",
    contentBase64: buffer.toString("base64"),
    contentHash: createHash("sha256").update(buffer).digest("hex"),
    etag: null,
    lastModified: null,
  }
}

export function fallbackFaviconUrlForHostname(
  hostname: string,
  size = DEFAULT_FAVICON_SIZE
): string | null {
  const normalizedHostname = hostname.trim().toLowerCase()
  if (!normalizedHostname) {
    return null
  }

  const normalizedSize = Math.max(16, Math.min(Math.floor(size), 256))
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(normalizedHostname)}&sz=${normalizedSize}`
}

function normalizeContentType(
  value: string | null,
  sourceUrl: string
): string | null {
  const fromHeader = (value ?? "").split(";")[0]?.trim().toLowerCase()
  if (fromHeader) {
    if (fromHeader.startsWith("image/")) {
      return fromHeader
    }
    if (fromHeader.includes("icon")) {
      return "image/x-icon"
    }
  }

  if (sourceUrl.endsWith(".ico")) {
    return "image/x-icon"
  }
  if (sourceUrl.endsWith(".svg")) {
    return "image/svg+xml"
  }
  if (sourceUrl.endsWith(".png")) {
    return "image/png"
  }
  if (sourceUrl.endsWith(".jpg") || sourceUrl.endsWith(".jpeg")) {
    return "image/jpeg"
  }
  if (sourceUrl.endsWith(".webp")) {
    return "image/webp"
  }

  return null
}

function buildCandidateUrls(
  hostname: string,
  options?: { skipGoogleFallback?: boolean; preferredSourceUrl?: string | null }
): string[] {
  const candidates = [
    options?.preferredSourceUrl ?? null,
    `https://${hostname}/favicon.ico`,
    ...(options?.skipGoogleFallback
      ? []
      : [fallbackFaviconUrlForHostname(hostname, DEFAULT_FAVICON_SIZE)]),
  ].filter((url): url is string => Boolean(url))

  return [...new Set(candidates)]
}

async function fetchFaviconAtUrl(
  sourceUrl: string,
  validation?: { etag?: string | null; lastModified?: string | null }
): Promise<FaviconFetchResult | null> {
  try {
    const response = await fetch(sourceUrl, {
      method: "GET",
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
      credentials: "omit",
      redirect: "follow",
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FaviconBot/1.0)",
        ...(validation?.etag ? { "If-None-Match": validation.etag } : {}),
        ...(validation?.lastModified ? { "If-Modified-Since": validation.lastModified } : {}),
      },
    })

    const responseUrl = response.url || sourceUrl
    const etag = normalizeCacheHeader(response.headers.get("etag"))
    const lastModified = normalizeCacheHeader(response.headers.get("last-modified"))

    if (response.status === 304) {
      return {
        status: "not-modified",
        responseUrl,
        etag: etag ?? validation?.etag ?? null,
        lastModified: lastModified ?? validation?.lastModified ?? null,
      }
    }

    if (!response.ok) {
      if (response.status >= 500) {
        console.warn(`[favicon] Server error fetching ${sourceUrl}: ${response.status}`)
      }
      return null
    }

    const declaredLength = Number.parseInt(
      response.headers.get("content-length") ?? "",
      10
    )
    if (Number.isFinite(declaredLength) && declaredLength > MAX_FAVICON_BYTES) {
      console.warn(`[favicon] Favicon too large at ${sourceUrl}: ${declaredLength} bytes`)
      return null
    }

    const contentType = normalizeContentType(
      response.headers.get("content-type"),
      responseUrl
    )
    if (!contentType) {
      console.warn(`[favicon] Invalid content type for ${sourceUrl}`)
      return null
    }

    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length === 0 || bytes.length > MAX_FAVICON_BYTES) {
      console.warn(`[favicon] Invalid size for ${sourceUrl}: ${bytes.length} bytes`)
      return null
    }

    return {
      status: "modified",
      responseUrl,
      contentType,
      contentBase64: bytes.toString("base64"),
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      etag,
      lastModified,
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "AbortError" || error.name === "TimeoutError") {
        console.warn(`[favicon] Timeout fetching ${sourceUrl}`)
      } else {
        console.warn(`[favicon] Error fetching ${sourceUrl}:`, error.message)
      }
    }
    return null
  }
}

async function resolveFromCandidateUrls(
  candidateUrls: string[],
  hostname: string
): Promise<ResolvedFaviconPayload | null> {
  for (const sourceUrl of candidateUrls) {
    const resolved = await fetchFaviconAtUrl(sourceUrl)
    if (resolved?.status === "modified") {
      console.log(`[favicon] Successfully fetched from ${sourceUrl}`)
      return {
        sourceUrl: resolved.responseUrl,
        contentType: resolved.contentType,
        contentBase64: resolved.contentBase64,
        contentHash: resolved.contentHash,
        etag: resolved.etag,
        lastModified: resolved.lastModified,
      }
    }
  }

  console.log(`[favicon] Using generated SVG for ${hostname}`)
  return generateFallbackFavicon(hostname)
}

/**
 * Resolve and download favicon image data for a hostname.
 * Falls back to a generated SVG if no favicon can be fetched.
 */
export async function resolveFavicon(
  hostname: string,
  options?: { skipGoogleFallback?: boolean; preferredSourceUrl?: string | null }
): Promise<ResolvedFaviconPayload | null> {
  if (!hostname) return null

  const candidateUrls = buildCandidateUrls(hostname, options)
  return resolveFromCandidateUrls(candidateUrls, hostname)
}

export async function revalidateFavicon(
  hostname: string,
  current: FaviconRevalidationState,
  options?: { skipGoogleFallback?: boolean }
): Promise<RevalidatedFaviconResult | null> {
  if (!hostname) {
    return null
  }

  const preferredSourceUrl =
    current.sourceUrl && !current.sourceUrl.startsWith("generated:")
      ? current.sourceUrl
      : null

  if (preferredSourceUrl) {
    const existing = await fetchFaviconAtUrl(preferredSourceUrl, {
      etag: current.etag ?? null,
      lastModified: current.lastModified ?? null,
    })

    if (existing?.status === "not-modified") {
      return {
        status: "not-modified",
        sourceUrl: existing.responseUrl,
        etag: existing.etag,
        lastModified: existing.lastModified,
      }
    }

    if (existing?.status === "modified") {
      return {
        status: "modified",
        favicon: {
          sourceUrl: existing.responseUrl,
          contentType: existing.contentType,
          contentBase64: existing.contentBase64,
          contentHash: existing.contentHash,
          etag: existing.etag,
          lastModified: existing.lastModified,
        },
      }
    }
  }

  const fallbackCandidates = buildCandidateUrls(hostname, {
    skipGoogleFallback: options?.skipGoogleFallback,
  }).filter((candidate) => candidate !== preferredSourceUrl)

  const resolved = await resolveFromCandidateUrls(fallbackCandidates, hostname)
  if (!resolved) {
    return null
  }

  return {
    status: "modified",
    favicon: resolved,
  }
}
