// Where the RSS feeds live in the public data bucket (written by src/utils/catalog/feeds.ts), and their
// public URLs for links on the site. Kept free of the feed builder's dependencies so client
// components can import it.

import { publicDataUrl } from "./publicData.ts";

export const FEEDS_PREFIX = "feeds";
export const HACK_FEEDS_PREFIX = `${FEEDS_PREFIX}/hacks/`;
export const UPDATES_FEED_KEY = `${FEEDS_PREFIX}/updates.xml`;
export const NEW_HACKS_FEED_KEY = `${FEEDS_PREFIX}/new.xml`;

export function hackFeedKey(slug: string) {
  return `${HACK_FEEDS_PREFIX}${encodeURIComponent(slug)}.xml`;
}

// Feeds are only linked when the bucket's public URL is set.
const feedUrl = (key: string) => {
  const base = publicDataUrl();
  return base ? `${base}/${key}` : null;
};

export const hackFeedUrl = (slug: string) => feedUrl(hackFeedKey(slug));
export const updatesFeedUrl = () => feedUrl(UPDATES_FEED_KEY);
export const newHacksFeedUrl = () => feedUrl(NEW_HACKS_FEED_KEY);

/** For `alternates.types` in page metadata: the site-wide feeds, plus a hack's own feed first. */
export function feedAlternates(slug?: string) {
  const feeds = [
    slug ? { title: "Versions of this hack", url: hackFeedUrl(slug) } : null,
    { title: "Hackdex: latest releases", url: updatesFeedUrl() },
    { title: "Hackdex: new hacks", url: newHacksFeedUrl() },
  ].filter((f): f is { title: string; url: string } => !!f?.url);
  return feeds.length > 0 ? { "application/rss+xml": feeds } : undefined;
}
