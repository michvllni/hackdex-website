import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildCompiledModule, COMPILED_PATH } from "../../scripts/build-emails.mjs";

test("compiled email templates match the MJML sources", async () => {
  const current = await readFile(COMPILED_PATH, "utf8");
  assert.equal(current, await buildCompiledModule(), "Run `npm run email:build` to regenerate src/emails/compiled.ts");
});
