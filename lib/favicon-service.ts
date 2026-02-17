import "server-only"

import { createHash } from "node:crypto"

const RESOLVE_TIMEOUT_MS = 5_000
const MAX_FAVICON_BYTES = 512 * 1024
const DEFAULT_FAVICON_SIZE = 64

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
    })

    if (!response.ok) {
      return null
    }

    const declaredLength = Number.parseInt(
      response.headers.get("content-length") ?? "",
      10
    )
    if (Number.isFinite(declaredLength) && declaredLength > MAX_FAVICON_BYTES) {
      return null
    }

    const contentType = normalizeContentType(
      response.headers.get("content-type"),
      sourceUrl
    )
    if (!contentType) {
      return null
    }

    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length === 0 || bytes.length > MAX_FAVICON_BYTES) {
      return null
    }

    return {
      contentType,
      contentBase64: bytes.toString("base64"),
      contentHash: createHash("sha256").update(bytes).digest("hex"),
    }
  } catch {
    return null
  }
}

/**
 * Resolve and download favicon image data for a hostname.
 * The payload is returned in its original image format plus MIME metadata.
 */
export async function resolveFavicon(hostname: string): Promise<ResolvedFaviconPayload | null> {
  if (!hostname) return null

  const candidateUrls = [
    `https://${hostname}/favicon.ico`,
    fallbackFaviconUrlForHostname(hostname, DEFAULT_FAVICON_SIZE),
  ].filter((url): url is string => Boolean(url))

  for (const sourceUrl of candidateUrls) {
    const resolved = await fetchFaviconAtUrl(sourceUrl)
    if (!resolved) {
      continue
    }

    return {
      sourceUrl,
      ...resolved,
    }
  }

  return null
}
