// Worker entry: OpenNext's generated handler plus the daily catalog reconcile.
// wrangler.jsonc points "main" here; `.open-next/worker.js` exists after `npm run cf:build`.

// @ts-ignore Generated at build time.
import { default as handler } from "./.open-next/worker.js";

// @ts-ignore Generated at build time. Every Durable Object class in wrangler.jsonc must be exported.
export { DOQueueHandler } from "./.open-next/worker.js";

type Env = {
  WORKER_SELF_REFERENCE: { fetch(input: string, init?: RequestInit): Promise<Response> };
  CATALOG_CRON_SECRET?: string;
};
type ExecutionContext = { waitUntil(promise: Promise<unknown>): void };

export default {
  fetch: handler.fetch,

  // Runs the reconcile inside the Next.js app, where the build-time settings it needs
  // (site URL, covers domain, Supabase URL) are available, by calling the app's own route.
  async scheduled(_controller: unknown, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(reconcileCatalog(env));
  },
};

async function reconcileCatalog(env: Env) {
  if (!env.CATALOG_CRON_SECRET) {
    console.warn("[catalog] CATALOG_CRON_SECRET isn't set; skipping the daily reconcile.");
    return;
  }
  const res = await env.WORKER_SELF_REFERENCE.fetch("https://worker.internal/api/catalog/refresh", {
    headers: { authorization: `Bearer ${env.CATALOG_CRON_SECRET}` },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`[catalog] Daily reconcile failed: ${res.status} ${body.slice(0, 500)}`);
  console.log("[catalog] Daily reconcile:", body);
}
