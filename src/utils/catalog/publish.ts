import { catalogHackKey, CATALOG_HACKS_PREFIX, CATALOG_INDEX_KEY, type CatalogHack, type CatalogIndex } from "./types.ts";
import {
  buildHackFeed,
  buildNewHacksFeed,
  buildUpdatesFeed,
  FEED_CONTENT_TYPE,
  FEED_FORMAT_VERSION,
  hackFeedKey,
  HACK_FEEDS_PREFIX,
  latestReleases,
  newestApproved,
  NEW_HACKS_FEED_KEY,
  UPDATES_FEED_KEY,
  type FeedContext,
} from "./feeds.ts";

/** The subset of an R2 bucket binding the catalog uses; an R2Bucket satisfies it. */
export interface CatalogBucket {
  head(key: string): Promise<{ customMetadata?: Record<string, string> } | null>;
  put(
    key: string,
    value: string,
    options: { httpMetadata: { contentType: string; cacheControl: string }; customMetadata: Record<string, string> },
  ): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
}

const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=600";
const RETRY_DELAY_MS = 1100; // R2 allows about one write per second to the same key
const CONCURRENCY = 10;

export type PublishStats = { written: string[]; deleted: string[]; unchanged: number };
const emptyStats = (): PublishStats => ({ written: [], deleted: [], unchanged: 0 });

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function put(bucket: CatalogBucket, key: string, body: string, contentType: string, customMetadata: Record<string, string>) {
  const options = { httpMetadata: { contentType, cacheControl: CACHE_CONTROL }, customMetadata };
  try {
    await bucket.put(key, body, options);
  } catch {
    // Most likely two edits of the same hack within a second. The body was built after this
    // request's write committed, so retrying once still stores current data.
    await sleep(RETRY_DELAY_MS);
    await bucket.put(key, body, options);
  }
}

/**
 * Writes `body` unless the stored object already has the same hash. Hashing excludes nothing, so
 * documents must not contain values that change on their own (see types.ts).
 */
async function putIfChanged(
  bucket: CatalogBucket,
  key: string,
  body: string,
  stats: PublishStats,
  contentType = "application/json; charset=utf-8",
) {
  const hash = await sha256Hex(body);
  const existing = await bucket.head(key);
  if (existing?.customMetadata?.sha256 === hash) {
    stats.unchanged++;
    return;
  }
  await put(bucket, key, body, contentType, { sha256: hash });
  stats.written.push(key);
}

/**
 * Writes a feed unless the stored one was rendered from the same input. Comparing the input
 * instead of the XML skips rendering markdown for unchanged feeds, which keeps the daily
 * reconcile cheap.
 */
async function putFeedIfChanged(
  bucket: CatalogBucket,
  key: string,
  source: unknown,
  render: () => string,
  ctx: FeedContext,
  stats: PublishStats,
) {
  const hash = await sha256Hex(JSON.stringify([FEED_FORMAT_VERSION, ctx.siteUrl, ctx.dataStorageUrl ?? null, source]));
  const existing = await bucket.head(key);
  if (existing?.customMetadata?.source === hash) {
    stats.unchanged++;
    return;
  }
  await put(bucket, key, render(), FEED_CONTENT_TYPE, { source: hash });
  stats.written.push(key);
}

async function deleteKeys(bucket: CatalogBucket, keys: string[], stats: PublishStats) {
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000); // R2's limit per delete call
    await bucket.delete(batch);
    stats.deleted.push(...batch);
  }
}

async function inBatches<T>(items: T[], fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    await Promise.all(items.slice(i, i + CONCURRENCY).map(fn));
  }
}

/**
 * Publishes the files (JSON and feed) for `slugs`. `docs` holds the public ones; a slug without a
 * doc has left the catalog. Order: hack files, then the index, then deletions, so the index never
 * lists a hack whose file doesn't exist yet.
 */
export async function publishHacks(
  bucket: CatalogBucket,
  slugs: string[],
  docs: Map<string, CatalogHack>,
  index: CatalogIndex | null,
  ctx: FeedContext,
): Promise<PublishStats> {
  const stats = emptyStats();
  await inBatches(
    slugs.filter((s) => docs.has(s)),
    async (slug) => {
      const doc = docs.get(slug)!;
      await putIfChanged(bucket, catalogHackKey(slug), JSON.stringify(doc), stats);
      await putFeedIfChanged(bucket, hackFeedKey(slug), doc, () => buildHackFeed(doc, ctx), ctx, stats);
    },
  );
  if (index) await publishIndex(bucket, index, stats);
  // Live updates also run for hacks that were never public (drafts, pending); only delete files
  // that exist. head is a free Class B operation, delete is a Class A one.
  const gone = slugs.filter((s) => !docs.has(s)).flatMap((s) => [catalogHackKey(s), hackFeedKey(s)]);
  const existing = (await Promise.all(gone.map(async (key) => ((await bucket.head(key)) ? key : null)))).filter(
    (key): key is string => key !== null,
  );
  await deleteKeys(bucket, existing, stats);
  return stats;
}

export async function publishIndex(bucket: CatalogBucket, index: CatalogIndex, stats = emptyStats()) {
  // generatedAt changes on every build; leave it out of the comparison.
  const comparable = JSON.stringify({ ...index, generatedAt: undefined });
  const hash = await sha256Hex(comparable);
  const existing = await bucket.head(CATALOG_INDEX_KEY);
  if (existing?.customMetadata?.contentSha256 === hash) {
    stats.unchanged++;
    return stats;
  }
  await bucket.put(CATALOG_INDEX_KEY, JSON.stringify(index), {
    httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: CACHE_CONTROL },
    customMetadata: { contentSha256: hash },
  });
  stats.written.push(CATALOG_INDEX_KEY);
  return stats;
}

/**
 * Writes the site-wide feeds (`feeds/updates.xml`, `feeds/new.xml`) from `hacks`, which must
 * include every hack that belongs in them (see loadSiteFeedSlugs in build.ts).
 */
export async function publishSiteFeeds(bucket: CatalogBucket, hacks: Iterable<CatalogHack>, ctx: FeedContext, stats = emptyStats()) {
  const all = [...hacks];
  const releases = latestReleases(all).map(({ hack, patch }) => ({ slug: hack.slug, title: hack.title, pageUrl: hack.pageUrl, patch }));
  await putFeedIfChanged(bucket, UPDATES_FEED_KEY, releases, () => buildUpdatesFeed(all, ctx), ctx, stats);
  const newest = newestApproved(all);
  await putFeedIfChanged(bucket, NEW_HACKS_FEED_KEY, newest, () => buildNewHacksFeed(newest, ctx), ctx, stats);
  return stats;
}

/**
 * Brings the whole bucket in line with the database: every public hack's file, the index, and
 * deletion of files for hacks that left. Normally writes nothing; any write means a live update
 * was missed.
 */
export async function reconcileCatalog(
  bucket: CatalogBucket,
  docs: Map<string, CatalogHack>,
  index: CatalogIndex,
  ctx: FeedContext,
): Promise<PublishStats> {
  const stored: string[] = [];
  for (const prefix of [CATALOG_HACKS_PREFIX, HACK_FEEDS_PREFIX]) {
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ prefix, cursor });
      stored.push(...page.objects.map((o) => o.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }

  const wanted = new Set([...docs.keys()].flatMap((slug) => [catalogHackKey(slug), hackFeedKey(slug)]));
  const stats = await publishHacks(bucket, [...docs.keys()], docs, index, ctx);
  await publishSiteFeeds(bucket, docs.values(), ctx, stats);
  await deleteKeys(bucket, stored.filter((key) => !wanted.has(key)), stats);
  return stats;
}
