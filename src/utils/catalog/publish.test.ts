import assert from "node:assert/strict";
import test from "node:test";
import { publishHacks, publishIndex, publishSiteFeeds, reconcileCatalog, type CatalogBucket } from "./publish.ts";
import { FEED_CONTENT_TYPE, hackFeedKey, NEW_HACKS_FEED_KEY, UPDATES_FEED_KEY } from "./feeds.ts";
import { CATALOG_INDEX_KEY, catalogHackKey, type CatalogHack, type CatalogIndex } from "./types.ts";

/** In-memory R2 stand-in that logs every operation in order. */
function fakeBucket(opts: { failPuts?: number } = {}) {
  const objects = new Map<string, { body: string; contentType: string; customMetadata: Record<string, string> }>();
  const log: string[] = [];
  let failPuts = opts.failPuts ?? 0;
  const bucket: CatalogBucket = {
    async head(key) {
      log.push(`head ${key}`);
      const obj = objects.get(key);
      return obj ? { customMetadata: obj.customMetadata } : null;
    },
    async put(key, value, options) {
      log.push(`put ${key}`);
      if (failPuts > 0) {
        failPuts--;
        throw new Error("put: Reduce your concurrent request rate for the same object. (10058)");
      }
      objects.set(key, { body: value, contentType: options.httpMetadata.contentType, customMetadata: options.customMetadata });
    },
    async delete(keys) {
      for (const key of [keys].flat()) {
        log.push(`delete ${key}`);
        objects.delete(key);
      }
    },
    async list({ prefix }) {
      return { objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false };
    },
  };
  return { bucket, objects, log };
}

const ctx = { siteUrl: "https://hackdex.test", dataStorageUrl: "https://data.hackdex.test" };
const doc = (slug: string, title = slug) =>
  ({ slug, title, summary: "", covers: [], patches: [], approvedAt: null, pageUrl: `${ctx.siteUrl}/hack/${slug}` }) as unknown as CatalogHack;
const files = (slug: string) => [catalogHackKey(slug), hackFeedKey(slug)];
const index = (slugs: string[], generatedAt = "2026-11-13T00:00:00Z") =>
  ({ schemaVersion: 1, generatedAt, baseRoms: [], tags: [], hacks: slugs.map((slug) => ({ slug, approvedAt: null, url: `hacks/${slug}.json` })) }) as CatalogIndex;
const writes = (log: string[]) => log.filter((l) => !l.startsWith("head "));

test("an unchanged hack file isn't written again", async () => {
  const { bucket, log } = fakeBucket();
  const docs = new Map([["a", doc("a")]]);
  await publishHacks(bucket, ["a"], docs, null, ctx);
  log.length = 0;
  const stats = await publishHacks(bucket, ["a"], docs, null, ctx);
  assert.deepEqual(writes(log), []);
  assert.equal(stats.unchanged, 2);

  await publishHacks(bucket, ["a"], new Map([["a", doc("a", "Renamed")]]), null, ctx);
  assert.deepEqual(writes(log), files("a").map((k) => `put ${k}`));
});

test("the index ignores generatedAt when deciding whether to write", async () => {
  const { bucket, log } = fakeBucket();
  await publishIndex(bucket, index(["a"], "2026-11-13T00:00:00Z"));
  log.length = 0;
  await publishIndex(bucket, index(["a"], "2026-11-14T00:00:00Z"));
  assert.deepEqual(writes(log), []);
  await publishIndex(bucket, index(["a", "b"]));
  assert.deepEqual(writes(log), [`put ${CATALOG_INDEX_KEY}`]);
});

test("approval writes the hack file before the index", async () => {
  const { bucket, log } = fakeBucket();
  await publishHacks(bucket, ["a"], new Map([["a", doc("a")]]), index(["a"]), ctx);
  assert.deepEqual(writes(log), [...files("a").map((k) => `put ${k}`), `put ${CATALOG_INDEX_KEY}`]);
});

test("deletion rewrites the index before removing the hack file", async () => {
  const { bucket, objects, log } = fakeBucket();
  await publishHacks(bucket, ["a"], new Map([["a", doc("a")]]), index(["a"]), ctx);
  log.length = 0;
  await publishHacks(bucket, ["a"], new Map(), index([]), ctx);
  assert.deepEqual(writes(log), [`put ${CATALOG_INDEX_KEY}`, ...files("a").map((k) => `delete ${k}`)]);
  assert.ok(!objects.has(catalogHackKey("a")));
  assert.ok(!objects.has(hackFeedKey("a")));
});

test("updates for hacks that were never public don't issue deletes", async () => {
  const { bucket, log } = fakeBucket();
  await publishHacks(bucket, ["draft"], new Map(), null, ctx);
  assert.deepEqual(writes(log), []);
});

test("a busy-object error is retried once", async () => {
  const { bucket, objects, log } = fakeBucket({ failPuts: 1 });
  await publishHacks(bucket, ["a"], new Map([["a", doc("a")]]), null, ctx);
  assert.deepEqual(writes(log), [`put ${catalogHackKey("a")}`, `put ${catalogHackKey("a")}`, `put ${hackFeedKey("a")}`]);
  assert.ok(objects.has(catalogHackKey("a")));
});

test("a second failure is thrown for the caller to log", async () => {
  const { bucket } = fakeBucket({ failPuts: 2 });
  await assert.rejects(publishHacks(bucket, ["a"], new Map([["a", doc("a")]]), null, ctx), /10058/);
});

test("reconcile removes files of hacks that left and writes nothing when in sync", async () => {
  const { bucket, objects, log } = fakeBucket();
  await publishHacks(bucket, ["a", "gone"], new Map([["a", doc("a")], ["gone", doc("gone")]]), index(["a", "gone"]), ctx);
  log.length = 0;

  const stats = await reconcileCatalog(bucket, new Map([["a", doc("a")]]), index(["a"]), ctx);
  assert.deepEqual(stats.deleted, files("gone"));
  assert.ok(!objects.has(catalogHackKey("gone")));
  assert.ok(objects.has(UPDATES_FEED_KEY) && objects.has(NEW_HACKS_FEED_KEY), "reconcile writes the site-wide feeds");

  log.length = 0;
  const again = await reconcileCatalog(bucket, new Map([["a", doc("a")]]), index(["a"]), ctx);
  assert.deepEqual(writes(log), []);
  // Hack file, hack feed, index, and the two site-wide feeds.
  assert.deepEqual(again, { written: [], deleted: [], unchanged: 5 });
});

test("slugs are URL-encoded in keys", () => {
  assert.equal(catalogHackKey("a b/c"), "catalog/v1/hacks/a%20b%2Fc.json");
  assert.equal(hackFeedKey("a b/c"), "feeds/hacks/a%20b%2Fc.xml");
});

test("feeds are stored as RSS and only re-rendered when their input changed", async () => {
  const { bucket, objects, log } = fakeBucket();
  await publishHacks(bucket, ["a"], new Map([["a", doc("a")]]), null, ctx);
  assert.equal(objects.get(hackFeedKey("a"))?.contentType, FEED_CONTENT_TYPE);
  assert.ok(objects.get(hackFeedKey("a"))?.body.includes("<rss"));

  // Same document, but a different catalog URL changes the self link, so the feed is rewritten.
  log.length = 0;
  await publishHacks(bucket, ["a"], new Map([["a", doc("a")]]), null, { ...ctx, dataStorageUrl: "https://other.test" });
  assert.deepEqual(writes(log), [`put ${hackFeedKey("a")}`]);
});

test("the site-wide feeds aren't rewritten when nothing in them changed", async () => {
  const { bucket, log } = fakeBucket();
  const released = {
    ...doc("a"),
    approvedAt: "2026-11-01T00:00:00Z",
    patches: [{ id: 1, version: "1.0", publishedAt: "2026-11-02T00:00:00Z", changelog: "First", breaksSaves: false }],
  } as unknown as CatalogHack;
  await publishSiteFeeds(bucket, [released], ctx);
  assert.deepEqual(writes(log), [`put ${UPDATES_FEED_KEY}`, `put ${NEW_HACKS_FEED_KEY}`]);

  log.length = 0;
  // A hack that is in neither feed doesn't change them.
  await publishSiteFeeds(bucket, [released, doc("unlisted")], ctx);
  assert.deepEqual(writes(log), []);

  await publishSiteFeeds(bucket, [{ ...released, title: "Renamed" }], ctx);
  assert.deepEqual(writes(log), [`put ${UPDATES_FEED_KEY}`, `put ${NEW_HACKS_FEED_KEY}`]);
});
