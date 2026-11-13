import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { loadHackDocs, loadIndex, type CatalogContext } from "./build.ts";
import { publishHacks, publishIndex, reconcileCatalog, type CatalogBucket, type PublishStats } from "./publish.ts";

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
  ctx: CatalogContext;
};

/** Null when the catalog isn't configured (no bucket binding or missing settings): a no-op, not an error. */
export function catalogDepsFromEnv(env: Env): CatalogDeps | null {
  const bucket = env.CATALOG_BUCKET as CatalogBucket | undefined;
  const supabaseUrl = str(env, "NEXT_PUBLIC_SUPABASE_URL");
  const secretKey = str(env, "SUPABASE_SECRET_KEY");
  const siteUrl = str(env, "NEXT_PUBLIC_SITE_URL");
  const coversDomain = str(env, "NEXT_PUBLIC_HACK_COVERS_DOMAIN");
  if (!bucket || !supabaseUrl || !secretKey || !siteUrl || !coversDomain) return null;
  return {
    bucket,
    supabase: createClient<Database>(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }),
    ctx: { siteUrl: siteUrl.replace(/\/+$/, ""), coversDomain: coversDomain.replace(/\/+$/, "") },
  };
}

/** Republishes these hacks' files; with `index`, also the index (approval, deletion). */
export async function updateCatalogHacks(deps: CatalogDeps, slugs: string[], opts: { index?: boolean } = {}): Promise<PublishStats> {
  const docs = await loadHackDocs(deps.supabase, deps.ctx, slugs);
  const index = opts.index ? await loadIndex(deps.supabase) : null;
  return publishHacks(deps.bucket, slugs, docs, index);
}

/** Rewrites the index only, e.g. after tag changes. */
export async function updateCatalogIndex(deps: CatalogDeps): Promise<PublishStats> {
  return publishIndex(deps.bucket, await loadIndex(deps.supabase));
}

export async function reconcileCatalogFromDb(deps: CatalogDeps): Promise<PublishStats> {
  const [docs, index] = await Promise.all([loadHackDocs(deps.supabase, deps.ctx), loadIndex(deps.supabase)]);
  return reconcileCatalog(deps.bucket, docs, index);
}
