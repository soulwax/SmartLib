import "server-only"

const RESOLVE_TIMEOUT_MS = 5_000

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
 * Try to resolve the best favicon URL for a given hostname.
 *
 * Resolution order:
 *   1. https://{hostname}/favicon.ico   (verified via HEAD)
 *   2. Google favicon service           (reliable fallback, always resolves)
 *
 * Returns null only if the hostname is unparseable.
 */
export async function resolveFaviconUrl(hostname: string): Promise<string | null> {
  if (!hostname) return null

  const directUrl = `https://${hostname}/favicon.ico`

  try {
    const response = await fetch(directUrl, {
      method: "HEAD",
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
      // Avoid sending cookies / credentials to third-party hosts
      credentials: "omit",
    })

    if (response.ok) {
      const ct = response.headers.get("content-type") ?? ""
      if (ct.startsWith("image/") || ct.includes("icon")) {
        return directUrl
      }
    }
  } catch {
    // Network error or timeout — fall through to Google
  }

  // Reliable fallback: Google's favicon CDN
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`
}
