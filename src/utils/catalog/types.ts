import type { Database } from "@/types/db";
import type { AiLevels } from "@/utils/aiDisclosure";
import type { TargetHash } from "@/utils/patching/target-hash";

// The public catalog's file formats (v1). This is a contract with third-party clients:
// within v1, only add optional fields. Anything else goes to v2/.
//
// Hack files must only hold data that changes when someone edits that hack. Counters,
// timestamps that move on their own (hacks.updated_at follows downloads) and anything
// relative to "now" would change the file without an edit and break change detection.

export const CATALOG_SCHEMA_VERSION = 1;
// Under catalog/ so the bucket's hostname can serve other static content under its own prefix.
export const CATALOG_PREFIX = "catalog/v1";
export const CATALOG_INDEX_KEY = `${CATALOG_PREFIX}/catalog.json`;
export const CATALOG_HACKS_PREFIX = `${CATALOG_PREFIX}/hacks/`;

/** Key of a hack's file, also its path relative to the index's folder minus `catalog/v1/`. */
export function catalogHackKey(slug: string) {
  return `${CATALOG_HACKS_PREFIX}${encodeURIComponent(slug)}.json`;
}

/** `catalog/v1/catalog.json`: written only when the set of public hacks (or tags) changes. */
export type CatalogIndex = {
  schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  generatedAt: string;
  baseRoms: { id: string; name: string; platform: string; region: string; crc32: string; sha1: string }[];
  tags: { id: number; name: string; category: Database["public"]["Enums"]["Tag Categories"] | null }[];
  hacks: { slug: string; approvedAt: string | null; url: string }[];
};

export type CatalogPatch = {
  id: number;
  version: string;
  format: Database["public"]["Enums"]["Patch Format"];
  publishedAt: string | null;
  breaksSaves: boolean;
  changelog: string | null;
  /** Whether the hack's download setting allows downloading this file directly. */
  downloadable: boolean;
  /** Present when `downloadable`: redirects to a short-lived file URL. */
  downloadUrl: string | null;
  /** The ROM this patch produces from the clean base ROM; null when unknown. */
  target: TargetHash | null;
};

/** `catalog/v1/hacks/{slug}.json`. The last real change is the object's Last-Modified header. */
export type CatalogHack = {
  schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  slug: string;
  title: string;
  summary: string;
  /** Markdown. */
  description: string;
  baseRomId: string;
  language: string;
  completionStatus: Database["public"]["Enums"]["Completion Status"] | null;
  /** The version the site shows, e.g. the custom version name when the custom patcher is on. */
  version: string;
  originalAuthor: string | null;
  permissionFrom: string | null;
  /** Hackdex username of the uploader. */
  uploader: string | null;
  /** In display order; names are in the index's `tags`. */
  tagIds: number[];
  covers: { url: string; alt: string | null }[];
  socialLinks: unknown;
  ai: { levels: AiLevels; note: string | null } | null;
  approvedAt: string | null;
  patchesDownloadPermission: Database["public"]["Enums"]["Patches Download Permission"];
  currentPatchId: number | null;
  /** The patch the site's patcher preselects. */
  defaultPatchId: number | null;
  /** Published, non-archived versions, oldest first. */
  patches: CatalogPatch[];
  pageUrl: string;
};
