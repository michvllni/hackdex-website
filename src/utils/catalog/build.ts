import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/db";
// Relative value imports: this module also runs in the Worker's cron handler and in node:test,
// neither of which resolves the "@/" alias.
import { aiDisclosureFromRow } from "../aiDisclosure.ts";
import { fetchInChunks } from "../array.ts";
import { sortOrderedTags } from "../format.ts";
import { resolveHackDisplayVersion } from "../patches/hack-display-version.ts";
import { baseRoms } from "../../data/baseRoms.ts";
import {
  CATALOG_SCHEMA_VERSION,
  catalogHackKey,
  CATALOG_PREFIX,
  type CatalogHack,
  type CatalogIndex,
  type CatalogPatch,
} from "./types.ts";

type Supabase = SupabaseClient<Database>;

export type CatalogContext = {
  /** e.g. https://hackdex.app, no trailing slash. */
  siteUrl: string;
  /** NEXT_PUBLIC_HACK_COVERS_DOMAIN. */
  coversDomain: string;
};

const CHUNK_SIZE = 150;
const ROW_BATCH_SIZE = 1000;

// Explicit allowlist. Never add verification_contact_info, created_by (as a value), approved_by,
// assigned_admin, rejected*, redirect_url, submitted_at, downloads or updated_at.
const HACK_COLUMNS =
  "slug,title,summary,description,base_rom,language,completion_status,custom_version_name,original_author,permission_from,social_links,approved_at,current_patch,patches_download_permission,created_by,ai_graphics,ai_music,ai_story,ai_translation,ai_events,ai_code,ai_note,ai_disclosed_at";

export type HackRow = Pick<
  Tables<"hacks">,
  | "slug" | "title" | "summary" | "description" | "base_rom" | "language" | "completion_status"
  | "custom_version_name" | "original_author" | "permission_from" | "social_links" | "approved_at"
  | "current_patch" | "patches_download_permission" | "created_by"
  | "ai_graphics" | "ai_music" | "ai_story" | "ai_translation" | "ai_events" | "ai_code" | "ai_note" | "ai_disclosed_at"
>;
export type CoverRow = Pick<Tables<"hack_covers">, "hack_slug" | "url" | "alt" | "position">;
export type HackTagRow = Pick<Tables<"hack_tags">, "hack_slug" | "tag_id" | "order">;
export type PatchRow = Pick<
  Tables<"patches">,
  | "id" | "parent_hack" | "version" | "format" | "published" | "published_at" | "archived"
  | "breaks_saves" | "changelog" | "target_sha1" | "target_crc32" | "target_size"
>;
export type PatcherRow = Pick<Tables<"hack_patcher_patches">, "hack_slug" | "patch_id" | "sort_order">;

/** Everything one hack's file is built from. Pure input, so the shape is testable without a database. */
export type HackDocInput = {
  hack: HackRow;
  uploader: string | null;
  covers: CoverRow[];
  tags: HackTagRow[];
  /** All of the hack's patches, including unpublished and archived ones. */
  patches: PatchRow[];
  /** The custom patcher's selection, in any order. */
  patcherRows: PatcherRow[];
};

export function assembleHackDoc(input: HackDocInput, ctx: CatalogContext): CatalogHack {
  const { hack } = input;
  const patchById = new Map(input.patches.map((p) => [p.id, p] as const));
  const publicPatches = input.patches.filter((p) => p.published && !p.archived).sort((a, b) => a.id - b.id);
  const publicIds = new Set(publicPatches.map((p) => p.id));

  const patcherRows = [...input.patcherRows].sort((a, b) => a.sort_order - b.sort_order);
  const isCustomPatcherActive = patcherRows.length > 0;
  // Same rules as getPatcherSelectablePatches and getPatchDownloadUrl.
  const selectableIds = patcherRows.map((r) => r.patch_id).filter((id) => publicIds.has(id));
  const hasSelectable = selectableIds.length > 0;
  const currentIsPublic = hack.current_patch !== null && publicIds.has(hack.current_patch);
  const defaultPatchId = hasSelectable ? selectableIds[0] : currentIsPublic ? hack.current_patch : null;

  const isDownloadable = (id: number) => {
    switch (hack.patches_download_permission) {
      case "All":
        return true;
      case "Current":
        return hasSelectable ? selectableIds.includes(id) : id === hack.current_patch;
      default:
        return false;
    }
  };

  const patches: CatalogPatch[] = publicPatches.map((p) => {
    const downloadable = isDownloadable(p.id);
    return {
      id: p.id,
      version: p.version,
      format: p.format,
      publishedAt: p.published_at,
      breaksSaves: p.breaks_saves,
      changelog: p.changelog,
      downloadable,
      downloadUrl: downloadable ? `${ctx.siteUrl}/api/patches/${p.id}/download` : null,
      target: p.target_crc32
        ? { sha1: p.target_sha1, crc32: p.target_crc32, size: p.target_size }
        : null,
    };
  });

  const firstPatcherPatch = patcherRows.map((r) => patchById.get(r.patch_id)).find(Boolean);
  const version = resolveHackDisplayVersion({
    isArchive: false,
    isCustomPatcherActive,
    customVersionName: hack.custom_version_name,
    customDefaultPatchVersion: firstPatcherPatch?.version,
    currentPatchVersion: hack.current_patch !== null ? patchById.get(hack.current_patch)?.version : undefined,
  });

  const ai = aiDisclosureFromRow(hack);

  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    slug: hack.slug,
    title: hack.title,
    summary: hack.summary,
    description: hack.description,
    baseRomId: hack.base_rom,
    language: hack.language,
    completionStatus: hack.completion_status,
    version,
    originalAuthor: hack.original_author,
    permissionFrom: hack.permission_from,
    uploader: input.uploader,
    tagIds: sortOrderedTags(input.tags.map((t) => ({ name: String(t.tag_id), order: t.order, id: t.tag_id }))).map((t) => t.id),
    covers: [...input.covers]
      .sort((a, b) => a.position - b.position)
      .map((c) => ({ url: `${ctx.coversDomain}/${c.url}`, alt: c.alt })),
    socialLinks: hack.social_links,
    ai: ai ? { levels: ai.levels, note: ai.note } : null,
    approvedAt: hack.approved_at,
    patchesDownloadPermission: hack.patches_download_permission,
    currentPatchId: currentIsPublic ? hack.current_patch : null,
    defaultPatchId,
    patches,
    pageUrl: `${ctx.siteUrl}/hack/${encodeURIComponent(hack.slug)}`,
  };
}

/** Same rule as discover and the hack page; RLS alone would let archive entries through. */
function publicHacks(supabase: Supabase, columns: string) {
  return supabase.from("hacks").select(columns).eq("approved", true).eq("is_archive", false).is("deleted_at", null);
}

async function paged<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ data: T[]; error: unknown }> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += ROW_BATCH_SIZE) {
    const { data, error } = await fetchPage(offset, offset + ROW_BATCH_SIZE - 1);
    if (error) return { data: [], error };
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < ROW_BATCH_SIZE) break;
  }
  return { data: rows, error: null };
}

function groupBy<T>(rows: T[], key: (row: T) => string | null) {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (k === null) continue;
    (map.get(k) ?? map.set(k, []).get(k)!).push(row);
  }
  return map;
}

/**
 * Builds the files of the given hacks, or of every public hack when `slugs` is omitted.
 * A slug missing from the result is not public (anymore): its file should be deleted.
 */
export async function loadHackDocs(
  supabase: Supabase,
  ctx: CatalogContext,
  slugs?: string[],
): Promise<Map<string, CatalogHack>> {
  let hacks: HackRow[];
  if (slugs) {
    const res = await fetchInChunks(slugs, CHUNK_SIZE, async (chunk) => {
      const { data, error } = await publicHacks(supabase, HACK_COLUMNS).in("slug", chunk).returns<HackRow[]>();
      return { data, error };
    });
    if (res.error) throw res.error;
    hacks = res.data;
  } else {
    const res = await paged((from, to) => publicHacks(supabase, HACK_COLUMNS).order("slug").range(from, to).returns<HackRow[]>());
    if (res.error) throw res.error;
    hacks = res.data;
  }
  if (hacks.length === 0) return new Map();
  const hackSlugs = hacks.map((h) => h.slug);

  const bySlug = <T>(fn: (chunk: string[]) => (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) =>
    fetchInChunks(hackSlugs, CHUNK_SIZE, (chunk) => paged(fn(chunk)));

  const [covers, tags, patches, patcher, profiles] = await Promise.all([
    bySlug<CoverRow>((chunk) => (from, to) =>
      supabase.from("hack_covers").select("hack_slug,url,alt,position").in("hack_slug", chunk).order("id").range(from, to)),
    bySlug<HackTagRow>((chunk) => (from, to) =>
      supabase.from("hack_tags").select("hack_slug,tag_id,order").in("hack_slug", chunk).order("hack_slug").order("tag_id").range(from, to)),
    bySlug<PatchRow>((chunk) => (from, to) =>
      supabase
        .from("patches")
        .select("id,parent_hack,version,format,published,published_at,archived,breaks_saves,changelog,target_sha1,target_crc32,target_size")
        .in("parent_hack", chunk)
        .order("id")
        .range(from, to)),
    bySlug<PatcherRow>((chunk) => (from, to) =>
      supabase.from("hack_patcher_patches").select("hack_slug,patch_id,sort_order").in("hack_slug", chunk).order("hack_slug").order("sort_order").range(from, to)),
    fetchInChunks([...new Set(hacks.map((h) => h.created_by))], CHUNK_SIZE, async (chunk) => {
      const { data, error } = await supabase.from("profiles").select("id,username").in("id", chunk);
      return { data, error };
    }),
  ]);
  for (const res of [covers, tags, patches, patcher, profiles]) if (res.error) throw res.error;

  const usernameById = new Map(profiles.data.map((p) => [p.id, p.username] as const));
  const coversBySlug = groupBy(covers.data, (r) => r.hack_slug);
  const tagsBySlug = groupBy(tags.data, (r) => r.hack_slug);
  const patchesBySlug = groupBy(patches.data, (r) => r.parent_hack);
  const patcherBySlug = groupBy(patcher.data, (r) => r.hack_slug);

  const docs = new Map<string, CatalogHack>();
  for (const hack of hacks) {
    docs.set(
      hack.slug,
      assembleHackDoc(
        {
          hack,
          uploader: usernameById.get(hack.created_by) ?? null,
          covers: coversBySlug.get(hack.slug) ?? [],
          tags: tagsBySlug.get(hack.slug) ?? [],
          patches: patchesBySlug.get(hack.slug) ?? [],
          patcherRows: patcherBySlug.get(hack.slug) ?? [],
        },
        ctx,
      ),
    );
  }
  return docs;
}

/** Public slugs of hacks created by a user, for republishing after a username change. */
export async function loadPublicSlugsByCreator(supabase: Supabase, userId: string): Promise<string[]> {
  const { data, error } = await publicHacks(supabase, "slug").eq("created_by", userId).returns<{ slug: string }[]>();
  if (error) throw error;
  return data.map((r) => r.slug);
}

export async function loadIndex(supabase: Supabase, now = new Date()): Promise<CatalogIndex> {
  const [hacks, tags] = await Promise.all([
    paged((from, to) => publicHacks(supabase, "slug,approved_at").order("slug").range(from, to).returns<Pick<HackRow, "slug" | "approved_at">[]>()),
    supabase.from("tags").select("id,name,category").order("id"),
  ]);
  if (hacks.error) throw hacks.error;
  if (tags.error) throw tags.error;

  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    baseRoms: baseRoms.map(({ id, name, platform, region, crc32, sha1 }) => ({ id, name, platform, region, crc32, sha1 })),
    tags: tags.data.map(({ id, name, category }) => ({ id, name, category })),
    hacks: hacks.data.map((h) => ({
      slug: h.slug,
      approvedAt: h.approved_at,
      url: catalogHackKey(h.slug).slice(CATALOG_PREFIX.length + 1),
    })),
  };
}
