import assert from "node:assert/strict";
import test from "node:test";
import { assembleHackDoc, loadHackDocs, loadIndex, type HackDocInput, type PatchRow } from "./build.ts";
import { sha256Hex } from "./publish.ts";

const ctx = { siteUrl: "https://hackdex.app", coversDomain: "https://covers.example" };

function patch(id: number, overrides: Partial<PatchRow> = {}): PatchRow {
  return {
    id,
    parent_hack: "demo",
    version: `v${id}`,
    format: "bps",
    published: true,
    published_at: `2026-01-0${id}T00:00:00Z`,
    archived: false,
    breaks_saves: false,
    changelog: null,
    target_sha1: null,
    target_crc32: null,
    target_size: null,
    ...overrides,
  };
}

function input(overrides: Partial<HackDocInput> = {}, hack: Partial<HackDocInput["hack"]> = {}): HackDocInput {
  return {
    hack: {
      slug: "demo",
      title: "Demo",
      summary: "A demo",
      description: "# Demo",
      base_rom: "poke_emerald",
      language: "English",
      completion_status: "Complete",
      custom_version_name: null,
      original_author: null,
      permission_from: null,
      social_links: null,
      approved_at: "2026-01-01T00:00:00Z",
      current_patch: 3,
      patches_download_permission: "All",
      created_by: "00000000-0000-4000-8000-000000000001",
      ai_graphics: null,
      ai_music: null,
      ai_story: null,
      ai_translation: null,
      ai_events: null,
      ai_code: null,
      ai_note: null,
      ai_disclosed_at: null,
      ...hack,
    },
    uploader: "creator",
    covers: [
      { hack_slug: "demo", url: "demo/b.png", alt: "second", position: 2 },
      { hack_slug: "demo", url: "demo/a.png", alt: null, position: 1 },
    ],
    tags: [
      { hack_slug: "demo", tag_id: 7, order: 2 },
      { hack_slug: "demo", tag_id: 4, order: 1 },
    ],
    patches: [patch(1), patch(2, { published: false }), patch(3), patch(4, { archived: true })],
    patcherRows: [],
    ...overrides,
  };
}

const FORBIDDEN_KEYS = [
  "verification_contact_info", "verificationContactInfo", "created_by", "createdBy", "approved_by", "approvedBy",
  "assigned_admin", "assignedAdmin", "rejected", "rejected_at", "rejection_reason", "redirect_url", "redirectUrl",
  "submitted_at", "submittedAt", "downloads", "updated_at", "updatedAt", "deleted_at", "deletedAt", "generatedAt",
];

function keysDeep(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysDeep(v, out);
    }
  }
  return out;
}

test("hack file lists only published, non-archived patches, oldest first", () => {
  const doc = assembleHackDoc(input(), ctx);
  assert.deepEqual(doc.patches.map((p) => p.id), [1, 3]);
  assert.equal(doc.currentPatchId, 3);
  assert.equal(doc.defaultPatchId, 3);
  assert.equal(doc.patches[0].downloadUrl, "https://hackdex.app/api/patches/1/download");
});

test("hack file never contains private or self-changing fields", () => {
  const doc = assembleHackDoc(input({}, { ai_disclosed_at: "2026-01-01T00:00:00Z", ai_note: "note" }), ctx);
  const keys = keysDeep(doc);
  for (const key of FORBIDDEN_KEYS) assert.ok(!keys.has(key), `unexpected key ${key}`);
  assert.ok(!JSON.stringify(doc).includes("00000000-0000-4000-8000-000000000001"), "uploader id leaked");
});

test("download permission decides which patches get a download URL", () => {
  const current = assembleHackDoc(input({}, { patches_download_permission: "Current" }), ctx);
  assert.deepEqual(current.patches.map((p) => [p.id, p.downloadable]), [[1, false], [3, true]]);
  assert.equal(current.patches[0].downloadUrl, null);

  const none = assembleHackDoc(input({}, { patches_download_permission: "None" }), ctx);
  assert.ok(none.patches.every((p) => !p.downloadable && p.downloadUrl === null));

  // With the custom patcher on, "Current" means the selectable patches.
  const patcher = assembleHackDoc(
    input({ patcherRows: [{ hack_slug: "demo", patch_id: 1, sort_order: 0 }] }, { patches_download_permission: "Current" }),
    ctx,
  );
  assert.deepEqual(patcher.patches.map((p) => [p.id, p.downloadable]), [[1, true], [3, false]]);
  assert.equal(patcher.defaultPatchId, 1);
});

test("a current patch that isn't public isn't exposed", () => {
  const doc = assembleHackDoc(input({}, { current_patch: 2 }), ctx);
  assert.equal(doc.currentPatchId, null);
  assert.equal(doc.defaultPatchId, null);
});

test("covers and tags keep the site's order; covers get public URLs", () => {
  const doc = assembleHackDoc(input(), ctx);
  assert.deepEqual(doc.covers, [
    { url: "https://covers.example/demo/a.png", alt: null },
    { url: "https://covers.example/demo/b.png", alt: "second" },
  ]);
  assert.deepEqual(doc.tagIds, [4, 7]);
  assert.equal(doc.pageUrl, "https://hackdex.app/hack/demo");
});

test("target hashes are included when the CRC32 is known", () => {
  const doc = assembleHackDoc(
    input({ patches: [patch(3, { target_crc32: "1f1c08fb", target_sha1: null, target_size: 16777216 })] }),
    ctx,
  );
  assert.deepEqual(doc.patches[0].target, { sha1: null, crc32: "1f1c08fb", size: 16777216 });
});

test("downloads, tag renames and profile changes don't change a hack file", async () => {
  const before = await sha256Hex(JSON.stringify(assembleHackDoc(input(), ctx)));
  // Rows as the database would return them if more columns were selected by mistake.
  const noisy = input({}, {
    ...({ downloads: 1234, updated_at: "2026-11-13T10:00:00Z" } as object),
  });
  const after = await sha256Hex(JSON.stringify(assembleHackDoc(noisy, ctx)));
  assert.equal(after, before);
});

/** Minimal stand-in for the Supabase query builder: records calls, returns rows per table. */
function fakeSupabase(tables: Record<string, Record<string, unknown>[]>) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const client = {
    from(table: string) {
      const rows = tables[table] ?? [];
      const filters: ((row: Record<string, unknown>) => boolean)[] = [];
      let range: [number, number] | null = null;
      const builder: Record<string, unknown> = {};
      const record = (method: string, apply?: (...args: unknown[]) => void) =>
        (...args: unknown[]) => {
          calls.push({ table, method, args });
          apply?.(...args);
          return builder;
        };
      Object.assign(builder, {
        select: record("select"),
        order: record("order"),
        returns: record("returns"),
        eq: record("eq", (col, val) => filters.push((r) => r[col as string] === val)),
        is: record("is", (col, val) => filters.push((r) => (r[col as string] ?? null) === val)),
        in: record("in", (col, vals) => filters.push((r) => (vals as unknown[]).includes(r[col as string]))),
        range: record("range", (from, to) => (range = [from as number, to as number])),
        then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
          let data = rows.filter((r) => filters.every((f) => f(r)));
          if (range) data = data.slice(range[0], range[1] + 1);
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      });
      return builder;
    },
  };
  return { client, calls };
}

const baseHack = input().hack;
const dbTables = () => ({
  hacks: [
    { ...baseHack, slug: "public", approved: true, is_archive: false, deleted_at: null },
    { ...baseHack, slug: "pending", approved: false, is_archive: false, deleted_at: null },
    { ...baseHack, slug: "archive", approved: true, is_archive: true, deleted_at: null },
    { ...baseHack, slug: "deleted", approved: true, is_archive: false, deleted_at: "2026-11-01T00:00:00Z" },
  ],
  patches: [patch(3, { parent_hack: "public" })],
  profiles: [{ id: baseHack.created_by, username: "creator" }],
  tags: [{ id: 4, name: "Story", category: "New" }],
});

test("only approved, non-archive, non-deleted hacks are built", async () => {
  const { client, calls } = fakeSupabase(dbTables());
  const docs = await loadHackDocs(client as never, ctx, ["public", "pending", "archive", "deleted"]);
  assert.deepEqual([...docs.keys()], ["public"]);
  assert.equal(docs.get("public")?.uploader, "creator");

  const select = calls.find((c) => c.table === "hacks" && c.method === "select")?.args[0] as string;
  for (const column of ["verification_contact_info", "approved_by", "assigned_admin", "redirect_url", "submitted_at", "downloads", "updated_at"]) {
    assert.ok(!select.split(",").includes(column), `selects ${column}`);
  }
});

test("the index lists public hacks and tags, rebuilt from the database", async () => {
  const { client } = fakeSupabase(dbTables());
  const index = await loadIndex(client as never, new Date("2026-11-13T00:00:00Z"));
  assert.deepEqual(index.hacks, [{ slug: "public", approvedAt: "2026-01-01T00:00:00Z", url: "hacks/public.json" }]);
  assert.deepEqual(index.tags, [{ id: 4, name: "Story", category: "New" }]);
  assert.ok(index.baseRoms.some((r) => r.id === "poke_emerald" && r.crc32 === "1f1c08fb"));
});
