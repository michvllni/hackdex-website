#!/usr/bin/env node
/**
 * worker-secrets.mjs - turn a GitHub Environment's secrets into a Worker secrets file
 *
 * SYNOPSIS
 *   GITHUB_SECRETS='${{ toJSON(secrets) }}' node scripts/worker-secrets.mjs <output.json>
 *
 * DESCRIPTION
 *   Reads the JSON object of secrets from the GITHUB_SECRETS environment variable and
 *   writes every one of them, except the CI-only names below, to <output.json> for
 *   `wrangler deploy --secrets-file`. Wrangler adds them to the deployed version;
 *   secrets that aren't in the file stay as they were. So the GitHub Environment is
 *   the one place where a Worker secret is set or changed.
 *
 *   Left out: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, github_token, and anything
 *   starting with CI_ (a prefix for future CI-only secrets).
 *
 * OPTIONS
 *   <output.json>   File to write (mode 0600)
 *   -h, --help      Show this help
 *
 * EXAMPLE
 *   GITHUB_SECRETS="$SECRETS_JSON" node scripts/worker-secrets.mjs "$RUNNER_TEMP/secrets.json"
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CI_ONLY = new Set(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "github_token"]);

function usage() {
  const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
  return source.slice(source.indexOf("/**") + 3, source.indexOf("*/")).replace(/^ \* ?/gm, "").trim();
}

/** Picks the secrets that belong on the Worker. Input: name → value. Output: the same, filtered. */
export function workerSecrets(all) {
  return Object.fromEntries(Object.entries(all).filter(([name]) => !CI_ONLY.has(name) && !name.startsWith("CI_")));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [output, ...rest] = process.argv.slice(2);
  if (output === "-h" || output === "--help") {
    console.log(usage());
    process.exit(0);
  }
  if (!output || rest.length > 0 || !process.env.GITHUB_SECRETS) {
    console.error(`Expected one output path and the GITHUB_SECRETS variable.\n\n${usage()}`);
    process.exit(2);
  }
  const secrets = workerSecrets(JSON.parse(process.env.GITHUB_SECRETS));
  writeFileSync(output, JSON.stringify(secrets), { mode: 0o600 });
  // Names only; values never reach the log.
  console.log(`Worker secrets: ${Object.keys(secrets).sort().join(", ") || "(none)"}`);
}
