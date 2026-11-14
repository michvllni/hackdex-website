import assert from "node:assert/strict";
import test from "node:test";
import { workerSecrets } from "./worker-secrets.mjs";

test("CI credentials never become Worker secrets", () => {
  const picked = workerSecrets({
    CLOUDFLARE_API_TOKEN: "t",
    CLOUDFLARE_ACCOUNT_ID: "a",
    github_token: "g",
    CI_DEPLOY_KEY: "k",
    SUPABASE_SECRET_KEY: "s",
    S3_ENDPOINT: "e",
  });
  assert.deepEqual(picked, { SUPABASE_SECRET_KEY: "s", S3_ENDPOINT: "e" });
});
