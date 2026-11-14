import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHackFeed,
  buildNewHacksFeed,
  buildUpdatesFeed,
  FEED_ITEM_LIMIT,
  hackFeedKey,
  markdownHtml,
  NEW_HACKS_FEED_KEY,
  UPDATES_FEED_KEY,
} from "./feeds.ts";
import type { CatalogHack, CatalogPatch } from "./types.ts";

const ctx = { siteUrl: "https://hackdex.test", dataStorageUrl: "https://data.hackdex.test" };

function patch(id: number, overrides: Partial<CatalogPatch> = {}): CatalogPatch {
  return {
    id,
    version: `v${id}`,
    format: "bps",
    publishedAt: new Date(Date.UTC(2026, 0, id)).toISOString(),
    breaksSaves: false,
    changelog: `Changes in ${id}`,
    downloadable: true,
    downloadUrl: null,
    target: null,
    ...overrides,
  };
}

function hack(slug: string, overrides: Partial<CatalogHack> = {}): CatalogHack {
  return {
    schemaVersion: 1,
    slug,
    title: `Hack ${slug}`,
    summary: `About ${slug}`,
    description: "",
    baseRomId: "poke_emerald",
    language: "English",
    completionStatus: null,
    version: "v1",
    originalAuthor: null,
    permissionFrom: null,
    uploader: "maker",
    tagIds: [],
    covers: [{ url: `https://covers.test/${slug}.png`, alt: null }],
    socialLinks: null,
    ai: null,
    approvedAt: "2025-12-01T00:00:00.000Z",
    patchesDownloadPermission: "All",
    currentPatchId: 1,
    defaultPatchId: 1,
    patches: [patch(1)],
    pageUrl: `${ctx.siteUrl}/hack/${slug}`,
    ...overrides,
  };
}

const items = (xml: string) => [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
const guids = (xml: string) => [...xml.matchAll(/<guid[^>]*>([^<]*)<\/guid>/g)].map((m) => m[1]);

test("a hack's feed lists its versions newest first, with changelogs", () => {
  const xml = buildHackFeed(hack("a", { patches: [patch(1), patch(3), patch(2, { breaksSaves: true })] }), ctx);
  assert.ok(xml.startsWith(`<?xml version="1.0" encoding="utf-8"?>`));
  assert.ok(xml.includes(`<rss version="2.0"`));
  assert.ok(xml.includes("<title>Hack a on Hackdex</title>"));
  assert.deepEqual(guids(xml), ["hackdex-patch-3", "hackdex-patch-2", "hackdex-patch-1"]);
  assert.ok(items(xml)[0].includes("<title><![CDATA[Hack a v3]]></title>"));
  assert.ok(items(xml)[0].includes("<link>https://hackdex.test/hack/a/versions</link>"));
  assert.ok(items(xml)[0].includes("<p>Changes in 3</p>"));
  assert.ok(items(xml)[1].includes("breaks existing saves"));
  assert.ok(xml.includes(`<atom:link href="https://data.hackdex.test/${hackFeedKey("a")}" rel="self"`));
});

test("feeds don't depend on the current time", async () => {
  const doc = hack("a", { patches: [patch(1), patch(2)] });
  const first = buildHackFeed(doc, ctx);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(buildHackFeed(doc, ctx), first);
  assert.ok(first.includes("<lastBuildDate>Fri, 02 Jan 2026 00:00:00 GMT</lastBuildDate>"), "newest item date");
  assert.equal(buildUpdatesFeed([doc], ctx), buildUpdatesFeed([doc], ctx));
  assert.equal(buildNewHacksFeed([doc], ctx), buildNewHacksFeed([doc], ctx));
});

test("renaming a version keeps its guid, so readers don't show it twice", () => {
  const before = buildHackFeed(hack("a", { patches: [patch(7)] }), ctx);
  const after = buildHackFeed(hack("a", { patches: [patch(7, { version: "v7-fixed" })] }), ctx);
  assert.notEqual(before, after);
  assert.deepEqual(guids(before), guids(after));
});

test("a hack's feed keeps the newest versions only and falls back to the approval date", () => {
  const many = Array.from({ length: FEED_ITEM_LIMIT + 5 }, (_, i) => patch(i + 1));
  assert.equal(items(buildHackFeed(hack("a", { patches: many }), ctx)).length, FEED_ITEM_LIMIT);

  const undated = buildHackFeed(hack("a", { patches: [patch(1, { publishedAt: null })] }), ctx);
  assert.ok(undated.includes("<pubDate>Mon, 01 Dec 2025 00:00:00 GMT</pubDate>"));
});

test("changelog markdown becomes safe HTML", () => {
  const html = markdownHtml("- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script> ok");
  assert.ok(html.includes("<li>one</li>"));
  assert.ok(html.includes("<table>"), "GFM tables");
  assert.ok(!html.includes("<script"), "raw HTML is dropped");
});

test("spoilers are hidden and CDATA can't be closed early", () => {
  const html = markdownHtml("The rival is ||your mom|| and `]]>` breaks things");
  assert.ok(!html.includes("your mom"));
  assert.ok(html.includes("<em>[spoiler]</em>"));
  assert.ok(!html.includes("]]>"));
  const xml = buildHackFeed(hack("a", { patches: [patch(1, { changelog: "a ]]> b" })] }), ctx);
  assert.equal(items(xml)[0].match(/\]\]>/g)?.length, 2, "only the title's and description's own CDATA ends");
});

test("without a catalog URL, feeds have no self link", () => {
  const xml = buildHackFeed(hack("a"), { siteUrl: ctx.siteUrl });
  assert.ok(!xml.includes("atom:link"));
});

test("the updates feed merges releases across hacks and skips undated ones", () => {
  const xml = buildUpdatesFeed(
    [
      hack("a", { patches: [patch(1), patch(4)] }),
      hack("b", { patches: [patch(2), patch(3), patch(5, { publishedAt: null })] }),
    ],
    ctx,
  );
  assert.deepEqual(guids(xml), ["hackdex-patch-4", "hackdex-patch-3", "hackdex-patch-2", "hackdex-patch-1"]);
  assert.ok(items(xml)[1].includes("<title><![CDATA[Hack b v3]]></title>"));
  assert.ok(xml.includes(`https://data.hackdex.test/${UPDATES_FEED_KEY}`));
});

test("the new-hacks feed lists the most recently approved hacks", () => {
  const approved = (slug: string, day: number) => hack(slug, { approvedAt: new Date(Date.UTC(2026, 1, day)).toISOString() });
  const many = Array.from({ length: FEED_ITEM_LIMIT + 2 }, (_, i) => approved(`h${i}`, i + 1));
  const xml = buildNewHacksFeed([...many, hack("pending", { approvedAt: null })], ctx);
  const ids = guids(xml);
  assert.equal(ids.length, FEED_ITEM_LIMIT);
  assert.equal(ids[0], `hackdex-hack-h${FEED_ITEM_LIMIT + 1}`);
  assert.ok(!ids.includes("hackdex-hack-pending"));
  assert.ok(!ids.includes("hackdex-hack-h0"), "oldest dropped");
  assert.ok(items(xml)[0].includes("Base ROM: Pokémon Emerald"));
  assert.ok(xml.includes(`https://data.hackdex.test/${NEW_HACKS_FEED_KEY}`));

  const renamed = buildNewHacksFeed([{ ...many[0], title: "Renamed" }], ctx);
  assert.deepEqual(guids(renamed), ["hackdex-hack-h0"]);
});

test("user text in the new-hacks feed is escaped", () => {
  const xml = buildNewHacksFeed([hack("a", { summary: `<img src=x onerror=alert(1)>` })], ctx);
  assert.ok(!xml.includes("<img src=x"));
  assert.ok(xml.includes("&lt;img src=x"));
});
