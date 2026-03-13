import "server-only"

import { createHash } from "node:crypto"

const RESOLVE_TIMEOUT_MS = 5_000
const MAX_FAVICON_BYTES = 512 * 1024
const MAX_DISCOVERY_BYTES = 256 * 1024
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

function isSupportedRemoteUrl(value: string): boolean {
  return value.startsWith("https://") || value.startsWith("http://")
}

function extractTagAttribute(tag: string, attribute: string): string | null {
  const pattern = new RegExp(
    `\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i"
  )
  const match = pattern.exec(tag)
  if (!match) {
    return null
  }

  return (match[1] ?? match[2] ?? match[3] ?? "").trim() || null
}

function parseLargestDeclaredSize(value: string | null): number {
  if (!value) {
    return 0
  }

  const matches = [...value.matchAll(/(\d+)x(\d+)/gi)]
  if (matches.length === 0) {
    return 0
  }

  return matches.reduce((largest, match) => {
    const width = Number.parseInt(match[1] ?? "", 10)
    const height = Number.parseInt(match[2] ?? "", 10)
    return Math.max(largest, width, height)
  }, 0)
}

function resolveDiscoveryUrl(value: string | null, baseUrl: string): string | null {
  if (!value) {
    return null
  }

  try {
    const resolved = new URL(value, baseUrl).toString()
    return isSupportedRemoteUrl(resolved) ? resolved : null
  } catch {
    return null
  }
}

function scoreDiscoveredIconCandidate(tag: string): number {
  const relValue = extractTagAttribute(tag, "rel")?.toLowerCase() ?? ""
  const relTokens = relValue.split(/\s+/).filter(Boolean)

  if (
    !relTokens.includes("icon") &&
    !relTokens.includes("apple-touch-icon") &&
    !relTokens.includes("mask-icon")
  ) {
    return Number.NEGATIVE_INFINITY
  }

  let score = 0

  if (relTokens.includes("shortcut") && relTokens.includes("icon")) {
    score += 120
  } else if (relTokens.includes("icon")) {
    score += 100
  } else if (relTokens.includes("apple-touch-icon")) {
    score += 70
  } else if (relTokens.includes("mask-icon")) {
    score += 35
  }

  const sizes = parseLargestDeclaredSize(extractTagAttribute(tag, "sizes"))
  score += Math.min(sizes, 256) / 8

  const typeValue = extractTagAttribute(tag, "type")?.toLowerCase() ?? ""
  if (typeValue.includes("svg")) {
    score += 8
  } else if (typeValue.startsWith("image/")) {
    score += 4
  }

  const hrefValue = extractTagAttribute(tag, "href")?.toLowerCase() ?? ""
  if (hrefValue.endsWith(".svg")) {
    score += 6
  } else if (hrefValue.endsWith(".png")) {
    score += 4
  } else if (hrefValue.endsWith(".ico")) {
    score += 2
  }

  return score
}

function extractDeclaredIconUrls(html: string, baseUrl: string): string[] {
  const scoredCandidates = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0])
    .map((tag) => {
      const score = scoreDiscoveredIconCandidate(tag)
      const url = resolveDiscoveryUrl(extractTagAttribute(tag, "href"), baseUrl)
      return { score, url }
    })
    .filter(
      (
        candidate
      ): candidate is { score: number; url: string } =>
        candidate.score > Number.NEGATIVE_INFINITY && Boolean(candidate.url)
    )
    .sort((left, right) => right.score - left.score)

  return [...new Set(scoredCandidates.map((candidate) => candidate.url))]
}

function extractManifestUrl(html: string, baseUrl: string): string | null {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0]
    const relValue = extractTagAttribute(tag, "rel")?.toLowerCase() ?? ""
    const relTokens = relValue.split(/\s+/).filter(Boolean)
    if (!relTokens.includes("manifest")) {
      continue
    }

    return resolveDiscoveryUrl(extractTagAttribute(tag, "href"), baseUrl)
  }

  return null
}

function extractManifestIconUrls(
  manifest: unknown,
  manifestUrl: string
): string[] {
  if (!manifest || typeof manifest !== "object" || !("icons" in manifest)) {
    return []
  }

  const icons = Array.isArray(manifest.icons) ? manifest.icons : []
  const scoredCandidates = icons
    .map((icon) => {
      if (!icon || typeof icon !== "object") {
        return null
      }

      const srcValue =
        "src" in icon && typeof icon.src === "string" ? icon.src : null
      const purposeValue =
        "purpose" in icon && typeof icon.purpose === "string"
          ? icon.purpose.toLowerCase()
          : ""
      const typeValue =
        "type" in icon && typeof icon.type === "string"
          ? icon.type.toLowerCase()
          : ""
      const sizesValue =
        "sizes" in icon && typeof icon.sizes === "string" ? icon.sizes : null
      const url = resolveDiscoveryUrl(srcValue, manifestUrl)
      if (!url) {
        return null
      }

      let score = 60 + Math.min(parseLargestDeclaredSize(sizesValue), 256) / 8
      if (purposeValue.includes("maskable")) {
        score += 8
      }
      if (typeValue.includes("svg")) {
        score += 6
      }

      return { score, url }
    })
    .filter((candidate): candidate is { score: number; url: string } => Boolean(candidate))
    .sort((left, right) => right.score - left.score)

  return [...new Set(scoredCandidates.map((candidate) => candidate.url))]
}

async function fetchTextDocument(
  sourceUrl: string,
  acceptedContentType: RegExp
): Promise<{ body: string; responseUrl: string } | null> {
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
      return null
    }

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase()
    if (!acceptedContentType.test(contentType)) {
      return null
    }

    const declaredLength = Number.parseInt(
      response.headers.get("content-length") ?? "",
      10
    )
    if (Number.isFinite(declaredLength) && declaredLength > MAX_DISCOVERY_BYTES) {
      return null
    }

    const body = await response.text()
    if (Buffer.byteLength(body, "utf8") > MAX_DISCOVERY_BYTES) {
      return null
    }

    return {
      body,
      responseUrl: response.url || sourceUrl,
    }
  } catch {
    return null
  }
}

async function discoverDeclaredFaviconUrls(hostname: string): Promise<string[]> {
  const homepage = await fetchTextDocument(`https://${hostname}/`, /text\/html|application\/xhtml\+xml/)
  if (!homepage) {
    return []
  }

  const declaredUrls = extractDeclaredIconUrls(homepage.body, homepage.responseUrl)
  const manifestUrl = extractManifestUrl(homepage.body, homepage.responseUrl)

  if (!manifestUrl) {
    return declaredUrls
  }

  const manifest = await fetchTextDocument(manifestUrl, /application\/manifest\+json|application\/json/)
  if (!manifest) {
    return declaredUrls
  }

  let manifestPayload: unknown = null
  try {
    manifestPayload = JSON.parse(manifest.body)
  } catch {
    manifestPayload = null
  }

  const manifestUrls = extractManifestIconUrls(
    manifestPayload,
    manifest.responseUrl
  )

  return [...new Set([...declaredUrls, ...manifestUrls])]
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

function buildStaticCandidateUrls(
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
  hostname: string,
  options?: { fallbackToGenerated?: boolean }
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

  if (!options?.fallbackToGenerated) {
    return null
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

  const faviconIcoUrl = `https://${hostname}/favicon.ico`
  const staticCandidates = buildStaticCandidateUrls(hostname, options)
  const staticWithoutGoogle = staticCandidates.filter(
    (candidate) =>
      candidate !== fallbackFaviconUrlForHostname(hostname, DEFAULT_FAVICON_SIZE)
  )

  const fastPathResult = await resolveFromCandidateUrls(
    staticWithoutGoogle,
    hostname
  )
  if (fastPathResult) {
    return fastPathResult
  }

  const discoveredCandidates = (await discoverDeclaredFaviconUrls(hostname)).filter(
    (candidate) =>
      candidate !== options?.preferredSourceUrl && candidate !== faviconIcoUrl
  )
  const discoveredResult = await resolveFromCandidateUrls(
    discoveredCandidates,
    hostname
  )
  if (discoveredResult) {
    return discoveredResult
  }

  const googleFallbackUrl = options?.skipGoogleFallback
    ? null
    : fallbackFaviconUrlForHostname(hostname, DEFAULT_FAVICON_SIZE)
  if (googleFallbackUrl) {
    const googleResult = await resolveFromCandidateUrls(
      [googleFallbackUrl],
      hostname
    )
    if (googleResult) {
      return googleResult
    }
  }

  return generateFallbackFavicon(hostname)
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

  const resolved = await resolveFavicon(hostname, {
    skipGoogleFallback: options?.skipGoogleFallback,
    preferredSourceUrl: null,
  })
  if (!resolved) {
    return null
  }

  return {
    status: "modified",
    favicon: resolved,
  }
}
