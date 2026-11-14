import { Feed } from "feed";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import type { Root } from "mdast";
// Relative value imports, like the other catalog modules (Worker cron and node:test).
import remarkSpoiler from "../markdown/remark-spoiler.ts";
import { baseRoms } from "../../data/baseRoms.ts";
import type { CatalogHack } from "./types.ts";
import { hackFeedKey, NEW_HACKS_FEED_KEY, UPDATES_FEED_KEY } from "../feeds.ts";

export { FEEDS_PREFIX, HACK_FEEDS_PREFIX, hackFeedKey, NEW_HACKS_FEED_KEY, UPDATES_FEED_KEY } from "../feeds.ts";

// RSS feeds, written to the public data bucket next to the JSON files (issue #41). Like the hack
// files, a feed is a pure function of the catalog documents: no "now", no counters, so an
// unchanged hack produces a byte-identical feed and the hash check skips the write.

export const FEED_CONTENT_TYPE = "application/rss+xml; charset=utf-8";
/** Bump when the feed output changes for the same documents, so every feed gets rewritten. */
export const FEED_FORMAT_VERSION = "2";
/** Items per feed; feed readers only look at the newest ones. */
export const FEED_ITEM_LIMIT = 50;

export type FeedContext = {
  /** e.g. https://hackdex.app, no trailing slash. */
  siteUrl: string;
  /** Public URL of the public data bucket, no trailing slash. Without it, feeds have no self link. */
  dataStorageUrl?: string;
};

/** Spoilers would show in plain sight in a feed reader, so their text is left out. */
function remarkHideSpoilers() {
  return (tree: Root) => {
    visit(tree, (node) => {
      if ((node.type as string) !== "spoiler") return;
      const spoiler = node as unknown as { children: unknown[]; data?: Record<string, unknown> };
      spoiler.children = [{ type: "text", value: "[spoiler]" }];
      spoiler.data = { hName: "em" };
    });
  };
}

// Raw HTML in the markdown is dropped (remark-rehype's default), so changelogs can't inject markup.
const markdownToHtml = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkSpoiler)
  .use(remarkHideSpoilers)
  .use(remarkRehype)
  .use(rehypeStringify);

export function markdownHtml(markdown: string): string {
  // The feed wraps HTML in CDATA, which can't contain its own terminator.
  return String(markdownToHtml.processSync(markdown)).replaceAll("]]>", "]]&gt;");
}

const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export type Release = { hack: CatalogHack; patch: CatalogHack["patches"][number]; date: Date };

/**
 * Published versions with a date. In a hack's own feed, versions without a publish date fall back
 * to the approval date; the site-wide feed skips them, since its live updates find hacks by
 * `patches.published_at` (loadSiteFeedSlugs) and must pick the same versions as the reconcile.
 */
function releases(hack: CatalogHack, fallbackToApproval: boolean): Release[] {
  return hack.patches
    .map((patch) => ({ hack, patch, date: new Date(patch.publishedAt ?? (fallbackToApproval ? hack.approvedAt : null) ?? NaN) }))
    .filter((r) => !Number.isNaN(r.date.getTime()));
}

const newestFirst = (a: Release, b: Release) => b.date.getTime() - a.date.getTime() || b.patch.id - a.patch.id;

function releaseHtml({ patch }: Release) {
  const parts = [patch.changelog?.trim() ? markdownHtml(patch.changelog) : `<p>Version ${escapeHtml(patch.version)} released.</p>`];
  if (patch.breaksSaves) parts.push("<p><strong>This version breaks existing saves.</strong></p>");
  return parts.join("\n");
}

function newFeed(opts: { title: string; description: string; link: string; key: string; updated: Date; image?: string }, ctx: FeedContext) {
  const self = ctx.dataStorageUrl ? `${ctx.dataStorageUrl}/${opts.key}` : undefined;
  return new Feed({
    title: opts.title,
    description: opts.description,
    id: opts.link,
    link: opts.link,
    language: "en",
    image: opts.image,
    favicon: `${ctx.siteUrl}/favicon.ico`,
    copyright: "",
    // Never "now": an unchanged feed must stay byte-identical.
    updated: opts.updated,
    generator: "Hackdex",
    feed: self,
    feedLinks: self ? { rss: self } : undefined,
    ttl: 60,
  });
}

/**
 * Many readers treat a guid as unique across all of a user's feeds (newsboat does), so a release
 * listed in both a hack's feed and the updates feed needs a different guid in each; otherwise it
 * moves between the two feeds on every refresh. `guidPrefix` tells the feeds apart.
 */
function addRelease(feed: Feed, release: Release, title: string, guidPrefix: string) {
  const id = `${guidPrefix}${release.patch.id}`;
  feed.addItem({
    title,
    id,
    guid: id,
    link: `${release.hack.pageUrl}/versions`,
    date: release.date,
    description: releaseHtml(release),
  });
}

const latest = (dates: Date[]) => new Date(Math.max(0, ...dates.map((d) => d.getTime())));

/** `feeds/hacks/{slug}.xml`: every published version of one hack. */
export function buildHackFeed(hack: CatalogHack, ctx: FeedContext): string {
  const items = releases(hack, true).sort(newestFirst).slice(0, FEED_ITEM_LIMIT);
  const feed = newFeed(
    {
      title: `${hack.title} on Hackdex`,
      description: hack.summary || `New versions of ${hack.title}`,
      link: hack.pageUrl,
      key: hackFeedKey(hack.slug),
      updated: latest(items.map((r) => r.date)),
      image: hack.covers[0]?.url,
    },
    ctx,
  );
  for (const release of items) addRelease(feed, release, `${hack.title} ${release.patch.version}`, "hackdex-patch-");
  return feed.rss2();
}

/** The versions `feeds/updates.xml` lists, newest first. */
export function latestReleases(hacks: Iterable<CatalogHack>): Release[] {
  return [...hacks].flatMap((h) => releases(h, false)).sort(newestFirst).slice(0, FEED_ITEM_LIMIT);
}

/** `feeds/updates.xml`: the newest versions across all hacks. */
export function buildUpdatesFeed(hacks: Iterable<CatalogHack>, ctx: FeedContext): string {
  const items = latestReleases(hacks);
  const feed = newFeed(
    {
      title: "Hackdex: latest releases",
      description: "New versions of ROM hacks on Hackdex",
      link: `${ctx.siteUrl}/discover`,
      key: UPDATES_FEED_KEY,
      updated: latest(items.map((r) => r.date)),
    },
    ctx,
  );
  for (const release of items) addRelease(feed, release, `${release.hack.title} ${release.patch.version}`, "hackdex-updates-patch-");
  return feed.rss2();
}

const baseRomNames = new Map(baseRoms.map((r) => [r.id, r.name] as const));

/** The newest approved hacks first; hacks without an approval date are left out. */
export function newestApproved(hacks: Iterable<CatalogHack>): CatalogHack[] {
  return [...hacks]
    .filter((h) => h.approvedAt && !Number.isNaN(Date.parse(h.approvedAt)))
    .sort((a, b) => Date.parse(b.approvedAt!) - Date.parse(a.approvedAt!) || a.slug.localeCompare(b.slug))
    .slice(0, FEED_ITEM_LIMIT);
}

function newHackHtml(hack: CatalogHack) {
  const cover = hack.covers[0];
  const parts: string[] = [];
  if (cover) parts.push(`<p><img src="${escapeHtml(cover.url)}" alt="${escapeHtml(cover.alt ?? hack.title)}"></p>`);
  if (hack.summary) parts.push(`<p>${escapeHtml(hack.summary)}</p>`);
  const details = [
    `Base ROM: ${baseRomNames.get(hack.baseRomId) ?? hack.baseRomId}`,
    hack.version ? `Version: ${hack.version}` : null,
    hack.uploader ? `Uploaded by ${hack.uploader}` : null,
  ].filter(Boolean) as string[];
  parts.push(`<p>${details.map(escapeHtml).join("<br>")}</p>`);
  return parts.join("\n");
}

/** `feeds/new.xml`: newly approved hacks, the feed counterpart of the catalog index. */
export function buildNewHacksFeed(hacks: Iterable<CatalogHack>, ctx: FeedContext): string {
  const items = newestApproved(hacks);
  const feed = newFeed(
    {
      title: "Hackdex: new hacks",
      description: "ROM hacks newly added to Hackdex",
      link: `${ctx.siteUrl}/discover`,
      key: NEW_HACKS_FEED_KEY,
      updated: latest(items.map((h) => new Date(h.approvedAt!))),
    },
    ctx,
  );
  for (const hack of items) {
    const id = `hackdex-hack-${hack.slug}`;
    feed.addItem({
      title: hack.title,
      id,
      guid: id,
      link: hack.pageUrl,
      date: new Date(hack.approvedAt!),
      description: newHackHtml(hack),
      image: hack.covers[0]?.url,
    });
  }
  return feed.rss2();
}
