import assert from "node:assert/strict";
import test from "node:test";
import { currentCatalog, scheduleCatalogIndexUpdate, scheduleCatalogUpdate, scheduleCatalogUpdateForCreator } from "./schedule.ts";
import { catalogDepsFromEnv } from "./run.ts";

test("outside Cloudflare the live updates are a no-op and never throw", () => {
  assert.equal(currentCatalog(), null);
  assert.doesNotThrow(() => {
    scheduleCatalogUpdate("demo", { index: true });
    scheduleCatalogIndexUpdate();
    scheduleCatalogUpdateForCreator("00000000-0000-4000-8000-000000000001");
  });
});

test("the catalog is off unless the bucket and every setting are present", () => {
  const complete = {
    PUBLIC_DATA_BUCKET: {},
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SECRET_KEY: "sb_secret_test",
    NEXT_PUBLIC_SITE_URL: "https://hackdex.app/",
    NEXT_PUBLIC_HACK_COVERS_DOMAIN: "https://covers.example/",
  };
  const deps = catalogDepsFromEnv(complete);
  assert.ok(deps);
  assert.deepEqual(deps.ctx, { siteUrl: "https://hackdex.app", coversDomain: "https://covers.example" });

  for (const key of Object.keys(complete)) {
    assert.equal(catalogDepsFromEnv({ ...complete, [key]: undefined }), null, `enabled without ${key}`);
  }
});
