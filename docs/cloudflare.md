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
| Deployed by | Every push to `main` | Publishing a GitHub release |
| Worker | `hackdex-website-staging` | `hackdex-website-production` |
| Address | `staging.hackdex.app` | `hackdex-website-production.<account>.workers.dev` until the switch, then `hackdex.app` |
| Page cache (R2) / tag cache (D1) | `hackdex-staging-next-cache` / `hackdex-staging-next-tag-cache` | `hackdex-next-cache` / `hackdex-next-tag-cache` |
| Settings | GitHub Environment `staging` | GitHub Environment `production` |

`wrangler.jsonc` declares both, and it's the only place resource names are written. Each run of `.github/workflows/deploy_cloudflare.yaml`:

1. creates the environment's buckets and databases if they don't exist yet,
2. uploads the GitHub Environment's secrets to the Worker (all of them except the Cloudflare credentials),
3. builds with the environment's `NEXT_PUBLIC_*` values and deploys. Wrangler creates the custom domain with its DNS record and certificate.

A deploy fails if one of the secrets in `secrets.required` is missing, instead of shipping a Worker that can't reach its storage. Staging and production need separate Supabase projects; otherwise staging writes to production data.

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

## Deploying

Deploy through the GitHub workflow, not from a laptop. OpenNext bakes `.env`, `.env.local` and `.env.production*` files into the bundle, so a local deploy would ship your local development values.

To try the Worker locally against your `.env.local`, run `npm run cf:preview`. It serves on http://localhost:8787.

## Known gaps

- **Next.js 15 is past end of support.** OpenNext refuses to build it without `--dangerouslyUseUnsupportedNextVersion`, which the `cf:*` scripts pass. Upgrading to Next 16 removes the flag, and is worth doing regardless of hosting.
- **Vercel Analytics** (`@vercel/analytics` in `src/app/layout.tsx`) doesn't report from Cloudflare. Cloudflare Web Analytics is free and can be turned on for the domain.
- **The site notice** (`/api/notice`) reads Vercel Edge Config, so it is always empty on Cloudflare. It needs a new home, such as a Supabase row or a KV key.
