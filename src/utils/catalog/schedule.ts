import { getCloudflareContext } from "@opennextjs/cloudflare";
import { catalogDepsFromEnv, updateCatalogHacks, updateCatalogIndex, type CatalogDeps } from "./run.ts";
import { loadPublicSlugsByCreator } from "./build.ts";

// Live catalog updates from server actions. They run after the response via waitUntil, never fail
// or slow the action, and do nothing outside Cloudflare (next dev, Vercel) or without a
// PUBLIC_DATA_BUCKET binding. The daily reconcile catches anything that goes wrong here.

/** The catalog settings for the current request; null outside Cloudflare or when it isn't configured. */
export function currentCatalog(): { deps: CatalogDeps; waitUntil: (p: Promise<unknown>) => void } | null {
  let cf: ReturnType<typeof getCloudflareContext>;
  try {
    cf = getCloudflareContext();
  } catch {
    return null;
  }
  const resolved = catalogDepsFromEnv({
    ...cf.env,
    // Spelled out so Next inlines the build-time values.
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_HACK_COVERS_DOMAIN: process.env.NEXT_PUBLIC_HACK_COVERS_DOMAIN,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  });
  return resolved ? { deps: resolved, waitUntil: (p) => (cf.ctx as { waitUntil(p: Promise<unknown>): void }).waitUntil(p) } : null;
}

function run(label: string, task: (d: CatalogDeps) => Promise<unknown>) {
  const d = currentCatalog();
  if (!d) return;
  d.waitUntil(
    task(d.deps).catch((error) => {
      console.error(`[catalog] ${label} failed; the daily reconcile will retry:`, error);
    }),
  );
}

/**
 * Call after a hack's public data changed and the write committed. Pass `index: true` when the set
 * of public hacks changed (approval, deletion).
 */
export function scheduleCatalogUpdate(slug: string, opts: { index?: boolean } = {}) {
  run(`update ${slug}`, (d) => updateCatalogHacks(d, [slug], opts));
}

/** After tag changes: names live in the index. */
export function scheduleCatalogIndexUpdate() {
  run("index update", (d) => updateCatalogIndex(d));
}

/** After a username change: every public hack by that user shows it. */
export function scheduleCatalogUpdateForCreator(userId: string) {
  run(`update hacks of ${userId}`, async (d) => {
    const slugs = await loadPublicSlugsByCreator(d.supabase, userId);
    if (slugs.length > 0) await updateCatalogHacks(d, slugs);
  });
}
