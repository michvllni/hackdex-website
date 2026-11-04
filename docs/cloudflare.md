# Deploying to Cloudflare Workers

The app can run on Cloudflare Workers through [OpenNext](https://opennext.js.org/cloudflare), alongside the existing Vercel deployment. Nothing here changes Vercel; the Worker only takes traffic once a custom domain points at it.

## How it fits together

- `npm run cf:build` runs `next build` and bundles the output into `.open-next/` (a Worker plus static assets).
- Static files (`/_next/static`, `public/`) are served by Cloudflare's asset layer without running the Worker, and aren't billed per request. Their headers come from `public/_headers`, not `next.config.ts`.
- ISR pages are stored in the R2 bucket `hackdex-next-cache`, time-based revalidation runs through the `DOQueueHandler` Durable Object, and `revalidateTag`/`revalidatePath` timestamps go to the D1 database `hackdex-next-tag-cache`. See `open-next.config.ts` and `wrangler.jsonc`.
- `cf:deploy` populates the R2 cache and creates the D1 table on every deploy.

## One-time setup

1. Upgrade the account to **Workers Paid** ($5/month). The free plan's 10 ms CPU limit per request is too low for server rendering.
2. Create the cache resources, and paste the D1 `database_id` into `wrangler.jsonc`:

   ```sh
   npx wrangler login
   npx wrangler r2 bucket create hackdex-next-cache
   npx wrangler d1 create hackdex-next-tag-cache
   ```

3. Set the runtime secrets on the Worker. These are the same values Vercel has today. Put them as `KEY=value` lines in a file such as `.dev.vars.production` (gitignored), then upload them all at once:

   ```sh
   npx wrangler secret bulk .dev.vars.production
   ```

   Every secret change deploys a new Worker version immediately, so one bulk upload beats running `wrangler secret put` once per secret. Delete the file afterwards. The secrets are:

   - `SUPABASE_SECRET_KEY`, `TURNSTILE_SECRET_KEY`
   - `S3_ENDPOINT`, `S3_PORT`, `S3_USE_SSL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `PATCHES_BUCKET`, `COVERS_BUCKET`
   - `PATCH_TOKEN_SECRET`, `PATCHES_DOWNLOAD_BASE_URL`
   - `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `RESEND_INBOUND_DOMAIN`, `RESEND_FROM`, `EMAIL_NOREPLY`, `EMAIL_CONTACT`
   - `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_GUILD_ID`, `DISCORD_BOT_TOKEN`, `DISCORD_REVIEW_FORUM_CHANNEL_ID`, `DISCORD_REPLY_ROLE_IDS`, `DISCORD_FORUM_TAG_PENDING_ID`, `DISCORD_FORUM_TAG_APPROVED_ID`, `DISCORD_FORUM_TAG_CLAIMED_ID`, `DISCORD_FORUM_TAG_UNCLAIMED_ID`
   - `DISCORD_WEBHOOK_ADMIN_URL`, `DISCORD_WEBHOOK_ADMIN_HACKS_URL`, `DISCORD_WEBHOOK_ADMIN_REPORTS_URL`, `DISCORD_WEBHOOK_HACKDEX_HACKS_URL`

   The Worker has to exist before secrets can be set, so run the first deploy (step 4) and then set the secrets.

   Placement is set to Smart Placement, which moves rendering next to Supabase once there's enough traffic. If you know the Supabase region, replace it with a fixed hint in `wrangler.jsonc`, e.g. `"placement": { "region": "aws:eu-west-1" }`.

4. In the GitHub repo settings, add:
   - **Secrets:** `CLOUDFLARE_API_TOKEN` (use the "Edit Cloudflare Workers" template, plus D1 edit), `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_SECRET_KEY`
   - **Variables:** the `NEXT_PUBLIC_*` values (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SITE_DOMAIN`, `NEXT_PUBLIC_HACK_COVERS_DOMAIN`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_DOWNLOADS_MILESTONE`, `NEXT_PUBLIC_NOTICE_KEY`)

   Then run **Actions → Deploy to Cloudflare Workers**. The site comes up on `hackdex-website.<account>.workers.dev` for comparison.

5. When it looks right, add the custom domain to the Worker (Workers → hackdex-website → Settings → Domains & Routes), and remove it from Vercel.

`SUPABASE_SECRET_KEY` is needed at build time as well as runtime, because `/discover` and `/hack/[slug]` are prerendered from Supabase.

## Deploying

Deploy through the GitHub workflow, not from a laptop. OpenNext bakes `.env`, `.env.local` and `.env.production*` files into the bundle, so a local `npm run cf:deploy` would ship your local development values.

To try the Worker locally against your `.env.local`, run `npm run cf:preview`. It serves on http://localhost:8787.

## Known gaps

- **Next.js 15 is past end of support.** OpenNext refuses to build it without `--dangerouslyUseUnsupportedNextVersion`, which the `cf:*` scripts pass. Upgrading to Next 16 removes the flag, and is worth doing regardless of hosting.
- **Vercel Analytics** (`@vercel/analytics` in `src/app/layout.tsx`) doesn't report from Cloudflare. Cloudflare Web Analytics is free and can be turned on for the domain.
- **The site notice** (`/api/notice`) reads Vercel Edge Config, so it is always empty on Cloudflare. It needs a new home, such as a Supabase row or a KV key.
