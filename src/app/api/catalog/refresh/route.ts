import { NextRequest, NextResponse } from "next/server";
import { checkUserRoles } from "@/utils/user";
import { createClient } from "@/utils/supabase/server";
import { currentCatalog } from "@/utils/catalog/schedule";
import { reconcileCatalogFromDb, updateCatalogHacks } from "@/utils/catalog/run";
import { sha256Hex } from "@/utils/catalog/publish";
import { CATALOG_LANDING_KEY } from "@/utils/catalog/landing";

/**
 * Brings the public catalog in line with the database: `?slug=x` for one hack (and the index),
 * otherwise everything. Admins can call it after a hand-run SQL change or a change to
 * NEXT_PUBLIC_HACK_COVERS_DOMAIN; the Worker's daily cron (worker.ts) calls it with
 * CATALOG_CRON_SECRET as a bearer token.
 */
export async function GET(req: NextRequest) {
  const fromCron = await isCronRequest(req);
  if (!fromCron) {
    const supa = await createClient();
    const { data: user } = await supa.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { isAdmin } = await checkUserRoles(supa);
    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const catalog = currentCatalog();
  if (!catalog) {
    return NextResponse.json({ error: "The catalog isn't configured here (no CATALOG_BUCKET binding)." }, { status: 503 });
  }

  const slug = req.nextUrl.searchParams.get("slug");
  const stats = slug
    ? await updateCatalogHacks(catalog.deps, [slug], { index: true })
    : await reconcileCatalogFromDb(catalog.deps);
  // Normally the live updates keep everything current, so the reconcile writes nothing. The landing
  // page is the exception: it changes with a deploy, not with data.
  const dataWrites = stats.written.filter((key) => key !== CATALOG_LANDING_KEY);
  if (fromCron && (dataWrites.length > 0 || stats.deleted.length > 0)) {
    console.warn("[catalog] Reconcile changed files; a live update was missed:", stats);
  }
  return NextResponse.json(stats);
}

async function isCronRequest(req: NextRequest) {
  const secret = process.env.CATALOG_CRON_SECRET;
  const header = req.headers.get("authorization");
  if (!secret || !header?.startsWith("Bearer ")) return false;
  // Compare digests so the comparison takes the same time however much of the token matches.
  const [given, expected] = await Promise.all([sha256Hex(header.slice("Bearer ".length)), sha256Hex(secret)]);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
