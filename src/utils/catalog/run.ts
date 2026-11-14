import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { loadHackDocs, loadIndex, loadSiteFeedSlugs, type CatalogContext } from "./build.ts";
import type { FeedContext } from "./feeds.ts";
import {
  publishHacks,
  publishIndex,
  publishSiteFeeds,
  reconcileCatalog,
  type CatalogBucket,
  type PublishStats,
} from "./publish.ts";

// Ties loading and publishing together. Used by server actions (through schedule.ts), the admin
// refresh route and the Worker's cron handler, so it must not import Next.js modules.

type Env = Record<string, unknown>;

function str(env: Env, key: string) {
  const v = env[key];
  return typeof v === "string" && v ? v : undefined;
}

export type CatalogDeps = {
  bucket: CatalogBucket;
  supabase: ReturnType<typeof createClient<Database>>;
  ctx: CatalogContext & FeedContext;
};

/** Null when the catalog isn't configured (no bucket binding or missing settings): a no-op, not an error. */
export function catalogDepsFromEnv(env: Env): CatalogDeps | null {
  const bucket = env.PUBLIC_DATA_BUCKET as CatalogBucket | undefined;
  const supabaseUrl = str(env, "NEXT_PUBLIC_SUPABASE_URL");
  const secretKey = str(env, "SUPABASE_SECRET_KEY");
  const siteUrl = str(env, "NEXT_PUBLIC_SITE_URL");
  const coversDomain = str(env, "NEXT_PUBLIC_HACK_COVERS_DOMAIN");
  // Optional: only the feeds' self links need it.
  const dataStorageUrl = str(env, "NEXT_PUBLIC_DATA_STORAGE_URL");
  if (!bucket || !supabaseUrl || !secretKey || !siteUrl || !coversDomain) return null;
  return {
    bucket,
    supabase: createClient<Database>(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }),
    ctx: {
      siteUrl: siteUrl.replace(/\/+$/, ""),
      coversDomain: coversDomain.replace(/\/+$/, ""),
      dataStorageUrl: dataStorageUrl?.replace(/\/+$/, ""),
    },
  };
}

/**
 * Republishes these hacks' files; with `index`, also the index (approval, deletion). The
 * site-wide feeds are rebuilt every time: any change to a hack may move it in or out of them,
 * and they are only written when their content changed.
 */
export async function updateCatalogHacks(deps: CatalogDeps, slugs: string[], opts: { index?: boolean } = {}): Promise<PublishStats> {
  const [docs, index, feedSlugs] = await Promise.all([
    loadHackDocs(deps.supabase, deps.ctx, slugs),
    opts.index ? loadIndex(deps.supabase) : null,
    loadSiteFeedSlugs(deps.supabase),
  ]);
  const stats = await publishHacks(deps.bucket, slugs, docs, index, deps.ctx);
  const missing = feedSlugs.filter((slug) => !docs.has(slug) && !slugs.includes(slug));
  const others = missing.length > 0 ? await loadHackDocs(deps.supabase, deps.ctx, missing) : new Map();
  const feedDocs = feedSlugs.map((slug) => docs.get(slug) ?? others.get(slug)).filter((doc) => doc !== undefined);
  await publishSiteFeeds(deps.bucket, feedDocs, deps.ctx, stats);
  return stats;
}

/** Rewrites the index only, e.g. after tag changes. */
export async function updateCatalogIndex(deps: CatalogDeps): Promise<PublishStats> {
  return publishIndex(deps.bucket, await loadIndex(deps.supabase));
}

export async function reconcileCatalogFromDb(deps: CatalogDeps): Promise<PublishStats> {
  const [docs, index] = await Promise.all([loadHackDocs(deps.supabase, deps.ctx), loadIndex(deps.supabase)]);
  return reconcileCatalog(deps.bucket, docs, index, deps.ctx);
}
