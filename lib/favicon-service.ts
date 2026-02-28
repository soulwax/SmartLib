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

  // Create SVG
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

async function fetchFaviconAtUrl(
  sourceUrl: string
): Promise<Omit<ResolvedFaviconPayload, "sourceUrl"> | null> {
  try {
    const response = await fetch(sourceUrl, {
      method: "GET",
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
      credentials: "omit",
      redirect: "follow",
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FaviconBot/1.0)",
      },
    })

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
      sourceUrl
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
      contentType,
      contentBase64: bytes.toString("base64"),
      contentHash: createHash("sha256").update(bytes).digest("hex"),
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

/**
 * Resolve and download favicon image data for a hostname.
 * Falls back to a generated SVG if no favicon can be fetched.
 *
 * @param hostname - The hostname to resolve favicon for
 * @param options - Optional configuration
 * @returns ResolvedFaviconPayload or null if hostname is invalid
 */
export async function resolveFavicon(
  hostname: string,
  options?: { skipGoogleFallback?: boolean }
): Promise<ResolvedFaviconPayload | null> {
  if (!hostname) return null

  const candidateUrls = [
    `https://${hostname}/favicon.ico`,
    ...(options?.skipGoogleFallback ? [] : [fallbackFaviconUrlForHostname(hostname, DEFAULT_FAVICON_SIZE)]),
  ].filter((url): url is string => Boolean(url))

  for (const sourceUrl of candidateUrls) {
    const resolved = await fetchFaviconAtUrl(sourceUrl)
    if (resolved) {
      console.log(`[favicon] Successfully fetched from ${sourceUrl}`)
      return {
        sourceUrl,
        ...resolved,
      }
    }
  }

  // Generate fallback SVG if no favicon could be fetched
  console.log(`[favicon] Using generated SVG for ${hostname}`)
  return generateFallbackFavicon(hostname)
}
