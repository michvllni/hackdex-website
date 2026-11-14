#!/usr/bin/env node
/**
 * cloudflare-resources.mjs - print the Cloudflare resources a Wrangler environment needs
 *
 * SYNOPSIS
 *   node scripts/cloudflare-resources.mjs --env <name> [--config <path>]
 *
 * DESCRIPTION
 *   Reads the Wrangler config with the environment applied (Wrangler's own parser, so
 *   inheritance works as in `wrangler deploy`) and prints one JSON object:
 *     { "worker": "...", "r2Buckets": ["..."], "d1Databases": ["..."] }
 *   The deploy workflow uses it to create missing buckets and databases before the
 *   first deploy, so wrangler.jsonc stays the only place resource names are written.
 *
 * OPTIONS
 *   --env <name>      Wrangler environment, e.g. staging or production (required)
 *   --config <path>   Wrangler config file (default: wrangler.jsonc)
 *   -h, --help        Show this help
 *
 * EXAMPLE
 *   node scripts/cloudflare-resources.mjs --env staging | jq -r '.r2Buckets[]'
 */
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { unstable_readConfig } from "wrangler";

function usage() {
  const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
  return source.slice(source.indexOf("/**") + 3, source.indexOf("*/")).replace(/^ \* ?/gm, "").trim();
}

let values;
try {
  ({ values } = parseArgs({
    options: { env: { type: "string" }, config: { type: "string", default: "wrangler.jsonc" }, help: { type: "boolean", short: "h" } },
  }));
} catch (error) {
  console.error(`${error.message}\n\n${usage()}`);
  process.exit(2);
}
if (values.help) {
  console.log(usage());
  process.exit(0);
}
if (!values.env) {
  console.error(`--env is required.\n\n${usage()}`);
  process.exit(2);
}

const config = unstable_readConfig({ config: values.config, env: values.env });
console.log(
  JSON.stringify({
    worker: config.name,
    r2Buckets: config.r2_buckets.map((b) => b.bucket_name).filter(Boolean),
    d1Databases: config.d1_databases.map((d) => d.database_name).filter(Boolean),
  }),
);
