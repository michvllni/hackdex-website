import assert from "node:assert/strict";
import test from "node:test";
import { publishHacks, publishIndex, reconcileCatalog, type CatalogBucket } from "./publish.ts";
import { CATALOG_INDEX_KEY, catalogHackKey, type CatalogHack, type CatalogIndex } from "./types.ts";

/** In-memory R2 stand-in that logs every operation in order. */
function fakeBucket(opts: { failPuts?: number } = {}) {
  const objects = new Map<string, { body: string; customMetadata: Record<string, string> }>();
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
      objects.set(key, { body: value, customMetadata: options.customMetadata });
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

const doc = (slug: string, title = slug) => ({ slug, title }) as unknown as CatalogHack;
const index = (slugs: string[], generatedAt = "2026-11-13T00:00:00Z") =>
  ({ schemaVersion: 1, generatedAt, baseRoms: [], tags: [], hacks: slugs.map((slug) => ({ slug, approvedAt: null, url: `hacks/${slug}.json` })) }) as CatalogIndex;
const writes = (log: string[]) => log.filter((l) => !l.startsWith("head "));

test("an unchanged hack file isn't written again", async () => {
  const { bucket, log } = fakeBucket();
  const docs = new Map([["a", doc("a")]]);
  await publishHacks(bucket, ["a"], docs, null);
  log.length = 0;
  const stats = await publishHacks(bucket, ["a"], docs, null);
  assert.deepEqual(writes(log), []);
  assert.equal(stats.unchanged, 1);

  await publishHacks(bucket, ["a"], new Map([["a", doc("a", "Renamed")]]), null);
  assert.deepEqual(writes(log), [`put ${catalogHackKey("a")}`]);
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
  await publishHacks(bucket, ["a"], new Map([["a", doc("a")]]), index(["a"]));
  assert.deepEqual(writes(log), [`put ${catalogHackKey("a")}`, `put ${CATALOG_INDEX_KEY}`]);
});

test("deletion rewrites the index before removing the hack file", async () => {
  const { bucket, objects, log } = fakeBucket();
  await publishHacks(bucket, ["a"], new Map([["a", doc("a")]]), index(["a"]));
  log.length = 0;
  await publishHacks(bucket, ["a"], new Map(), index([]));
  assert.deepEqual(writes(log), [`put ${CATALOG_INDEX_KEY}`, `delete ${catalogHackKey("a")}`]);
  assert.ok(!objects.has(catalogHackKey("a")));
});

test("updates for hacks that were never public don't issue deletes", async () => {
  const { bucket, log } = fakeBucket();
  await publishHacks(bucket, ["draft"], new Map(), null);
  assert.deepEqual(writes(log), []);
});

test("a busy-object error is retried once", async () => {
  const { bucket, objects, log } = fakeBucket({ failPuts: 1 });
  await publishHacks(bucket, ["a"], new Map([["a", doc("a")]]), null);
  assert.deepEqual(writes(log), [`put ${catalogHackKey("a")}`, `put ${catalogHackKey("a")}`]);
  assert.ok(objects.has(catalogHackKey("a")));
});

test("a second failure is thrown for the caller to log", async () => {
  const { bucket } = fakeBucket({ failPuts: 2 });
  await assert.rejects(publishHacks(bucket, ["a"], new Map([["a", doc("a")]]), null), /10058/);
});

test("reconcile removes files of hacks that left and writes nothing when in sync", async () => {
  const { bucket, objects, log } = fakeBucket();
  await publishHacks(bucket, ["a", "gone"], new Map([["a", doc("a")], ["gone", doc("gone")]]), index(["a", "gone"]));
  log.length = 0;

  const stats = await reconcileCatalog(bucket, new Map([["a", doc("a")]]), index(["a"]));
  assert.deepEqual(stats.deleted, [catalogHackKey("gone")]);
  assert.ok(!objects.has(catalogHackKey("gone")));

  log.length = 0;
  const again = await reconcileCatalog(bucket, new Map([["a", doc("a")]]), index(["a"]));
  assert.deepEqual(writes(log), []);
  assert.deepEqual(again, { written: [], deleted: [], unchanged: 2 });
});

test("slugs are URL-encoded in keys", () => {
  assert.equal(catalogHackKey("a b/c"), "v1/hacks/a%20b%2Fc.json");
});
