// The public data bucket (catalog, later RSS feeds) is served from its own hostname, e.g.
// https://data.hackdex.app. NEXT_PUBLIC_DATA_STORAGE_URL is inlined at build time, so client
// components can read it too.

/** The data bucket's public URL without a trailing slash; null when it isn't configured. */
export function publicDataUrl(): string | null {
  return process.env.NEXT_PUBLIC_DATA_STORAGE_URL?.replace(/\/+$/, "") || null;
}
