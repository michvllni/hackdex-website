import assert from "node:assert/strict";
import test from "node:test";
import { CATALOG_LANDING_KEY, catalogLandingHtml } from "./landing.ts";
import { publishLanding, type CatalogBucket } from "./publish.ts";
import { CATALOG_INDEX_KEY } from "./types.ts";

test("the landing page links the site and the catalog, relative to its own host", () => {
  const html = catalogLandingHtml("https://hackdex.app");
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes(`href="https://hackdex.app"`));
  assert.ok(html.includes("Back to hackdex.app"));
  assert.ok(html.includes(`href="${CATALOG_INDEX_KEY}"`), "index link is relative");
  assert.ok(!/\$\{/.test(html), "unfilled template placeholder");
});

test("the site URL is escaped", () => {
  const html = catalogLandingHtml(`https://example.test/?a="><script>x</script>`);
  assert.ok(!html.includes("<script>x</script>"));
  assert.ok(html.includes("&quot;&gt;&lt;script&gt;"));
});

test("the landing page is stored as HTML and not rewritten when unchanged", async () => {
  const stored = new Map<string, { contentType: string; sha256: string }>();
  let puts = 0;
  const bucket = {
    async head(key: string) {
      const o = stored.get(key);
      return o ? { customMetadata: { sha256: o.sha256 } } : null;
    },
    async put(key: string, _v: string, o: { httpMetadata: { contentType: string }; customMetadata: Record<string, string> }) {
      puts++;
      stored.set(key, { contentType: o.httpMetadata.contentType, sha256: o.customMetadata.sha256 });
    },
  } as unknown as CatalogBucket;

  const html = catalogLandingHtml("https://hackdex.app");
  assert.deepEqual((await publishLanding(bucket, html)).written, [CATALOG_LANDING_KEY]);
  assert.equal(stored.get(CATALOG_LANDING_KEY)?.contentType, "text/html; charset=utf-8");
  assert.equal((await publishLanding(bucket, html)).unchanged, 1);
  assert.equal(puts, 1);
});
