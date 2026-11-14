# Deploying to Cloudflare Workers

The app can run on Cloudflare Workers through [OpenNext](https://opennext.js.org/cloudflare), alongside the existing Vercel deployment. Nothing here changes Vercel; the Worker only takes traffic once a custom domain points at it.

## How it fits together

- `npm run cf:build` runs `next build` and bundles the output into `.open-next/` (a Worker plus static assets).
- Static files (`/_next/static`, `public/`) are served by Cloudflare's asset layer without running the Worker, and aren't billed per request. Their headers come from `public/_headers`, not `next.config.ts`.
- ISR pages are stored in an R2 bucket, time-based revalidation runs through the `DOQueueHandler` Durable Object, and `revalidateTag`/`revalidatePath` timestamps go to a D1 database. See `open-next.config.ts` and `wrangler.jsonc`.
- Each deploy populates the R2 cache and creates the D1 table (`opennextjs-cloudflare deploy`).

## Environments

| | Staging | Production |
|---|---|---|
| Deployed by | Every push to `main`, once the repository variable `STAGING_ENABLED` is `true` | Publishing a GitHub release |
| Worker | `hackdex-website-staging` | `hackdex-website-production` |
| Address | `staging.hackdex.app` | `hackdex-website-production.<account>.workers.dev` until the switch, then `hackdex.app` |
| Page cache (R2) / tag cache (D1) | `hackdex-staging-next-cache` / `hackdex-staging-next-tag-cache` | `hackdex-next-cache` / `hackdex-next-tag-cache` |
| Settings | GitHub Environment `staging` | GitHub Environment `production` |

`wrangler.jsonc` declares both, and it's the only place resource names are written. Each run of `.github/workflows/deploy_cloudflare.yaml`:

1. creates the environment's buckets and databases if they don't exist yet,
2. uploads the GitHub Environment's secrets to the Worker (all of them except the Cloudflare credentials),
3. builds with the environment's `NEXT_PUBLIC_*` values and deploys. Wrangler creates the custom domain with its DNS record and certificate.

A deploy fails if one of the secrets in `secrets.required` is missing, instead of shipping a Worker that can't reach its storage. Staging and production need separate Supabase projects; otherwise staging writes to production data. That's why staging is off until `STAGING_ENABLED` is set: production can go live first, and staging follows once it has its own database.

## One-time setup

These are the only manual steps; everything else comes from the repository.

1. Upgrade the Cloudflare account to **Workers Paid** ($5/month). The free plan's 10 ms CPU limit per request is too low for server rendering.
2. Create an API token (My Profile → API Tokens) from the "Edit Cloudflare Workers" template, and add **Account → D1 → Edit** and **Account → Workers R2 Storage → Edit**. Limit it to this account and the `hackdex.app` zone.
3. In the GitHub repo settings, create the Environments `staging` and `production`. Optionally, require a reviewer for `production`. Give each:
   - **Secrets:**
     - `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, used by CI only
     - the Worker's runtime secrets, which are the same values Vercel has today:
       - required: `SUPABASE_SECRET_KEY`, `TURNSTILE_SECRET_KEY`, `S3_ENDPOINT`, `S3_USE_SSL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `PATCHES_BUCKET`, `COVERS_BUCKET`
       - optional: `S3_PORT`, `S3_REGION`, `PATCH_TOKEN_SECRET`, `PATCHES_DOWNLOAD_BASE_URL`, the `RESEND_*`/`EMAIL_*` values for email, and the `DISCORD_*` values for Discord
   - **Variables:** the `NEXT_PUBLIC_*` values (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SITE_DOMAIN`, `NEXT_PUBLIC_HACK_COVERS_DOMAIN`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_DOWNLOADS_MILESTONE`, `NEXT_PUBLIC_NOTICE_KEY`)

   Values set at repository level apply to both environments unless an environment overrides them.
4. Deploy staging (push to `main`, or **Actions → Deploy to Cloudflare Workers → Run workflow**), then production by publishing a release.

To change a secret, change it in the GitHub Environment and redeploy. Secrets removed there stay on the Worker until you delete them with `npx wrangler secret delete <NAME> --env <environment>`.

**Switching production from Vercel:** remove the DNS records of `hackdex.app` that point to Vercel, add the `routes` shown in the comment in `wrangler.jsonc` under `env.production`, and publish a release. A custom domain can't take over a hostname that still has a CNAME record.

`SUPABASE_SECRET_KEY` is needed at build time as well as runtime, because `/discover` and `/hack/[slug]` are prerendered from Supabase.

## Public catalog

Third-party clients read the hack catalog as static JSON from the public data bucket (`PUBLIC_DATA_BUCKET`: `hackdex-public-data`, on staging `hackdex-staging-public-data`), never from the app. The bucket is served from its own hostname, the one in `NEXT_PUBLIC_DATA_STORAGE_URL`, e.g. `https://data.hackdex.app`:

- `catalog/v1/catalog.json`: base ROMs, tags, and the list of public hacks. It changes only when a hack is approved or deleted, or tags change.
- `catalog/v1/hacks/{slug}.json`: one public hack with its published patches and their download links. Each object's `Last-Modified` header is the time of its last real change.

The docs for client developers are the app's `/developers` page, which is only built when `NEXT_PUBLIC_DATA_STORAGE_URL` is set.

**How it stays current:**
- Server actions that change a public hack update its file right after the response (`src/utils/catalog/schedule.ts`).
- A daily cron at 03:17 UTC (`worker.ts`) reconciles the whole bucket with the database. It normally writes nothing; if it does, Workers Logs get a warning naming the files, which means a live update was missed.
- Admins can reconcile right away at `/api/catalog/refresh`, or for one hack at `/api/catalog/refresh?slug=…`. Do that after changing data by hand in SQL, or after changing `NEXT_PUBLIC_HACK_COVERS_DOMAIN`, since cover URLs are in every file.

Without the `PUBLIC_DATA_BUCKET` binding all of this is switched off, e.g. on Vercel or in `next dev`.

**Setup:** the deploy workflow does it. It creates the bucket, sets its CORS policy from `cloudflare/public-data-cors.json` (`GET`/`HEAD` from any origin, exposing `ETag` and `Last-Modified`), and connects the hostname from `NEXT_PUBLIC_DATA_STORAGE_URL` to the bucket. That hostname must be in a zone on the same account. What's left:

1. Set `NEXT_PUBLIC_DATA_STORAGE_URL` (variable) and `CATALOG_CRON_SECRET` (secret, any long random string, e.g. from `openssl rand -hex 32`) in each GitHub Environment. Without the secret, the daily cron skips the reconcile.
2. After the first deploy, fill the bucket once by opening `/api/catalog/refresh` as an admin.

**Caching:** files are sent with `Cache-Control: public, max-age=300, stale-while-revalidate=600`. Cloudflare doesn't cache `.json` at its edge by default, so every read goes to R2: free for the first 10 million reads a month, then $0.36 per million. Watch the bucket's Class B operations in the R2 dashboard. If reads grow too much, add a Cache Rule for the hostname (eligible for cache, edge TTL "use cache-control header", browser TTL "respect origin"); changes then reach clients within about 5–15 minutes instead of right away. Independently, the zone's **Browser Cache TTL** setting raises lower `max-age` values; set it to "Respect Existing Headers" so clients don't keep stale copies for hours.

## Deploying

Deploy through the GitHub workflow, not from a laptop. OpenNext bakes `.env`, `.env.local` and `.env.production*` files into the bundle, so a local deploy would ship your local development values.

To try the Worker locally against your `.env.local`, run `npm run cf:preview`. It serves on http://localhost:8787.

## Known gaps

- **Next.js 15 is past end of support.** OpenNext refuses to build it without `--dangerouslyUseUnsupportedNextVersion`, which the `cf:*` scripts pass. Upgrading to Next 16 removes the flag, and is worth doing regardless of hosting.
- **Vercel Analytics** (`@vercel/analytics` in `src/app/layout.tsx`) doesn't report from Cloudflare. Cloudflare Web Analytics is free and can be turned on for the domain.
- **The site notice** (`/api/notice`) reads Vercel Edge Config, so it is always empty on Cloudflare. It needs a new home, such as a Supabase row or a KV key.
