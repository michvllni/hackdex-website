import React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Markdown from "@/components/Markdown/Markdown";
import { publicDataUrl } from "@/utils/publicData";
import { CATALOG_INDEX_KEY, CATALOG_PREFIX } from "@/utils/catalog/types";
import { HACK_FEEDS_PREFIX, NEW_HACKS_FEED_KEY, UPDATES_FEED_KEY } from "@/utils/feeds";

export const metadata: Metadata = {
  title: "Developers",
  description: "The Hackdex catalog: every public hack as static JSON and RSS, free to use from any site, app or script.",
  alternates: {
    canonical: "/developers",
  },
};

/** Docs for the public catalog in the data bucket. Hidden when no bucket URL is configured. */
export default function DevelopersPage() {
  const base = publicDataUrl();
  if (!base) notFound();
  const index = `${base}/${CATALOG_INDEX_KEY}`;

  const body = `
Every public hack on Hackdex as static JSON: titles, descriptions, covers, tags, versions and download links. Read it from any site, app or script. No key needed, and CORS is open to all origins.

## Files

**[\`${CATALOG_INDEX_KEY}\`](${index})**
Start here. Base ROMs with their hashes, all tags, and every public hack with the path to its file. Changes only when a hack is approved or removed, or tags change.

**\`${CATALOG_PREFIX}/hacks/{slug}.json\`**
One hack: details, covers, tag IDs, and its published versions with download links and target ROM hashes. Rewritten only when the hack itself changes.

## RSS feeds

- **[\`${UPDATES_FEED_KEY}\`](${base}/${UPDATES_FEED_KEY})**: the 50 newest versions across all hacks, with their changelogs.
- **[\`${NEW_HACKS_FEED_KEY}\`](${base}/${NEW_HACKS_FEED_KEY})**: the 50 hacks most recently added to Hackdex.
- **\`${HACK_FEEDS_PREFIX}{slug}.xml\`**: every version of one hack. Each hack page links its own feed.

## Good to know

- **Hack paths are relative to the index.** Resolve each entry's \`url\` against the URL of \`catalog.json\`. Slugs are URL-encoded in paths.
- **Poll politely.** Files say they may be cached for 5 minutes. Send \`If-None-Match\` with the last \`ETag\` and you get a \`304\` when nothing changed. A hack file's \`Last-Modified\` is the time of its last real change.
- **Downloads go through Hackdex.** A version has a \`downloadUrl\` only when its uploader allows direct downloads. It redirects to a short-lived file link, so store the \`downloadUrl\`, never where it redirects to.
- **Verify patched ROMs.** \`target\` holds the CRC32, and where known the SHA-1 and size, of the ROM the patch produces from the clean base ROM listed in \`baseRoms\`.
- **Stable within v1.** New fields may be added; breaking changes get a new path such as \`catalog/v2/\`. Check \`schemaVersion\` if you want to be sure.
- **Credit the creators.** Link to each hack's \`pageUrl\` on Hackdex, where players find the full page, the patcher and updates.

## Example

\`\`\`js
const base = new URL("${index}");
const catalog = await (await fetch(base)).json();

for (const entry of catalog.hacks) {
  const hack = await (await fetch(new URL(entry.url, base))).json();
  const latest = hack.patches.find((p) => p.id === hack.currentPatchId);
  console.log(hack.title, latest?.version, latest?.downloadUrl);
}
\`\`\`
`;

  return (
    <div className="mx-auto max-w-screen-lg px-6 py-6 sm:py-12">
      <h1 className="font-display text-[28px] leading-[1.1] md:text-[32px]">Hackdex catalog</h1>
      {/* The typography plugin wraps inline code in visible backticks; the code style is enough here. */}
      <div className="mt-6 prose prose-invert max-w-none faq-prose [&_code]:before:content-none [&_code]:after:content-none">
        <Markdown>{body}</Markdown>
      </div>
    </div>
  );
}
