import { CATALOG_INDEX_KEY, CATALOG_PREFIX } from "./types.ts";
import { LOGO_PNG_BASE64 } from "./landingLogo.ts";

/**
 * The page at the root of the catalog's hostname, so people who open it in a browser find docs
 * instead of R2's 404. Written by the reconcile (see run.ts) with the site's own URL, so it follows
 * the deployment it belongs to. Styles mirror src/app/globals.css; it's a standalone file, so they
 * are copied, not imported.
 */
export const CATALOG_LANDING_KEY = "index.html";

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function catalogLandingHtml(siteUrl: string): string {
  const site = escapeHtml(siteUrl);
  const siteHost = escapeHtml(new URL(siteUrl).host);
  const index = escapeHtml(CATALOG_INDEX_KEY);
  const hacks = escapeHtml(`${CATALOG_PREFIX}/hacks/`);
  const logo = `data:image/png;base64,${LOGO_PNG_BASE64}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hackdex catalog</title>
<meta name="description" content="Every public hack on Hackdex as static JSON, free to read from any site or tool.">
<link rel="icon" href="${logo}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=Geist+Mono:wght@400;500&display=swap">
<style>
:root {
  color-scheme: light;
  --rose: #f43f5e; --rose-soft: #ffe4e9; --rose-text: #be123c; --link: #a8425a;
  --bg: #f3f4f6; --surface: #ffffff; --surface-2: #e9ebef; --well: #dfe2e7;
  --text: #1a1d24; --text-2: #4b5261; --text-3: #5f6674;
  --line: #e3e6ea; --line-strong: #c9ced6;
  --ready: #15803d; --ready-soft: #dcfce7;
  --shadow-rest: 0 1px 2px rgba(20, 24, 33, .05);
  --r-card: 12px; --r-control: 8px;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --rose-soft: #3b1220; --rose-text: #fb7185; --link: #e28a98;
    --bg: #15171b; --surface: #1f2126; --surface-2: #2a2d33; --well: #101215;
    --text: #f1f2f4; --text-2: #b3b8c2; --text-3: #8a909c;
    --line: #2e3138; --line-strong: #3d414a;
    --ready: #4ade80; --ready-soft: #14301f;
    --shadow-rest: none;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; min-height: 100vh; display: flex; flex-direction: column;
  background: var(--bg); color: var(--text);
  font: 15px/1.6 Archivo, ui-sans-serif, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
}
a { color: var(--link); text-underline-offset: 2px; }
a:hover { color: var(--rose-text); }
code, pre { font-family: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
:not(pre) > code { background: var(--surface-2); border-radius: 4px; padding: 1px 5px; overflow-wrap: anywhere; }
.display { font-stretch: 88%; font-weight: 700; letter-spacing: -0.01em; }
.wrap { width: 100%; max-width: 1164px; margin: 0 auto; padding: 0 24px; }
@media (max-width: 480px) { .wrap { padding: 0 16px; } }

header { background: var(--surface); border-bottom: 1px solid var(--line); }
header .wrap { height: 60px; display: flex; align-items: center; gap: 12px; }
.brand { display: inline-flex; align-items: center; gap: 10px; color: var(--text); text-decoration: none; font-size: 19px; }
.brand:hover { color: var(--text); }
.brand img { width: 28px; height: 28px; border-radius: 7px; }
.pill { font-size: 12px; font-weight: 600; color: var(--rose-text); background: var(--rose-soft); border-radius: 999px; padding: 2px 9px; }
header .back { margin-left: auto; font-weight: 500; color: var(--text-2); text-decoration: none; border-radius: var(--r-control); padding: 8px 10px; }
header .back:hover { background: var(--surface-2); color: var(--text); }

main { flex: 1; }
main .wrap { max-width: 820px; padding-top: 48px; padding-bottom: 64px; }
h1 { font-size: 32px; line-height: 1.1; margin: 0 0 12px; }
h2 { font-size: 20px; line-height: 1.2; margin: 48px 0 12px; }
.lede { color: var(--text-2); font-size: 17px; margin: 0; max-width: 640px; }

.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; margin-top: 28px;
  background: var(--line); border: 1px solid var(--line); border-radius: var(--r-card); overflow: hidden; box-shadow: var(--shadow-rest); }
.stat { background: var(--surface); padding: 14px 16px; }
.stat b { display: block; font-size: 22px; line-height: 1.2; font-stretch: 88%; }
.stat span { font-size: 13px; color: var(--text-3); }
@media (max-width: 640px) { .stats { grid-template-columns: repeat(2, 1fr); } }

.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-card); box-shadow: var(--shadow-rest); }
.files { display: grid; gap: 12px; }
.file { padding: 16px 18px; display: grid; grid-template-columns: 1fr auto; gap: 4px 16px; align-items: start; }
.file code { background: none; padding: 0; font-size: 14px; font-weight: 500; color: var(--text); }
.file p { margin: 0; grid-column: 1; color: var(--text-2); font-size: 14px; }
.file a.open { grid-row: 1 / span 2; grid-column: 2; align-self: center; font-weight: 600; font-size: 14px; text-decoration: none;
  border: 1px solid var(--line-strong); color: var(--text); border-radius: var(--r-control); padding: 6px 12px; white-space: nowrap; }
.file a.open:hover { background: var(--surface-2); }
@media (max-width: 480px) { .file { grid-template-columns: 1fr; } .file a.open { grid-row: auto; grid-column: 1; justify-self: start; margin-top: 8px; } }

ul.notes { margin: 0; padding: 0; list-style: none; }
ul.notes li { padding: 12px 0; border-top: 1px solid var(--line); color: var(--text-2); }
ul.notes li:first-child { border-top: 0; padding-top: 0; }
ul.notes strong { color: var(--text); font-weight: 600; }

pre { margin: 0; padding: 16px 18px; overflow-x: auto; background: var(--well); border-radius: var(--r-card); line-height: 1.55; color: var(--text); }

footer { border-top: 1px solid var(--line); color: var(--text-2); font-size: 13px; }
footer .wrap { padding-top: 24px; padding-bottom: 32px; display: flex; flex-wrap: wrap; gap: 8px 20px; }
footer a { color: var(--text-2); text-decoration: none; }
footer a:hover { color: var(--text); }
</style>
</head>
<body>
<header>
  <div class="wrap">
    <a class="brand display" href="${site}"><img src="${logo}" alt=""><span>Hackdex</span></a>
    <span class="pill">Catalog</span>
    <a class="back" href="${site}">Back to ${siteHost}</a>
  </div>
</header>

<main>
  <div class="wrap">
    <h1 class="display">Hackdex catalog</h1>
    <p class="lede">Every public hack on Hackdex as static JSON: titles, descriptions, covers, tags, versions and download links. Read it from any site, app or script. No key needed, and CORS is open to all origins.</p>

    <div class="stats" aria-live="polite">
      <div class="stat"><b id="n-hacks">–</b><span>public hacks</span></div>
      <div class="stat"><b id="n-tags">–</b><span>tags</span></div>
      <div class="stat"><b id="n-roms">–</b><span>base ROMs</span></div>
      <div class="stat"><b id="updated">–</b><span>list last changed</span></div>
    </div>

    <h2 class="display">Files</h2>
    <div class="files">
      <div class="card file">
        <code>${index}</code>
        <p>Start here. Base ROMs with their hashes, all tags, and every public hack with the path to its file. Changes only when a hack is approved or removed, or tags change.</p>
        <a class="open" href="${index}">Open</a>
      </div>
      <div class="card file">
        <code>${hacks}{slug}.json</code>
        <p>One hack: details, covers, tag IDs, and its published versions with download links and target ROM hashes. Rewritten only when the hack itself changes.</p>
        <a class="open" id="example-hack" href="${index}">Example</a>
      </div>
    </div>

    <h2 class="display">Good to know</h2>
    <div class="card" style="padding: 18px;">
      <ul class="notes">
        <li><strong>Hack paths are relative to the index.</strong> Resolve each entry's <code>url</code> against the URL of <code>catalog.json</code>. Slugs are URL-encoded in paths.</li>
        <li><strong>Poll politely.</strong> Files are cached for 5 minutes. Send <code>If-None-Match</code> with the last <code>ETag</code> and you get a <code>304</code> when nothing changed. A hack file's <code>Last-Modified</code> is the time of its last real change.</li>
        <li><strong>Downloads go through Hackdex.</strong> A version has a <code>downloadUrl</code> only when its uploader allows direct downloads. It redirects to a short-lived file link, so store the <code>downloadUrl</code>, never where it redirects to.</li>
        <li><strong>Verify patched ROMs.</strong> <code>target</code> holds the CRC32, and where known the SHA-1 and size, of the ROM the patch produces from the clean base ROM listed in <code>baseRoms</code>.</li>
        <li><strong>Stable within v1.</strong> New fields may be added; breaking changes get a new path such as <code>catalog/v2/</code>. Check <code>schemaVersion</code> if you want to be sure.</li>
        <li><strong>Credit the creators.</strong> Link to each hack's <code>pageUrl</code> on Hackdex, where players find the full page, the patcher and updates.</li>
      </ul>
    </div>

    <h2 class="display">Example</h2>
    <pre><code>const base = new URL("<span id="index-url">${index}</span>");
const catalog = await (await fetch(base)).json();

for (const entry of catalog.hacks) {
  const hack = await (await fetch(new URL(entry.url, base))).json();
  const latest = hack.patches.find((p) =&gt; p.id === hack.currentPatchId);
  console.log(hack.title, latest?.version, latest?.downloadUrl);
}</code></pre>
  </div>
</main>

<footer>
  <div class="wrap">
    <span>Data from <a href="${site}">Hackdex</a></span>
    <a href="${site}/discover">Discover hacks</a>
    <a href="${site}/faq">FAQ</a>
    <a href="https://github.com/Hackdex-App/hackdex-website">GitHub</a>
  </div>
</footer>

<script>
document.getElementById("index-url").textContent = new URL(${JSON.stringify(CATALOG_INDEX_KEY)}, location.href).href;
(async () => {
  try {
    const res = await fetch(${JSON.stringify(CATALOG_INDEX_KEY)});
    if (!res.ok) return;
    const c = await res.json();
    const set = (id, v) => { document.getElementById(id).textContent = v; };
    set("n-hacks", c.hacks.length.toLocaleString("en"));
    set("n-tags", c.tags.length.toLocaleString("en"));
    set("n-roms", c.baseRoms.length.toLocaleString("en"));
    const modified = res.headers.get("last-modified");
    if (modified) set("updated", new Date(modified).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }));
    const first = c.hacks[0];
    if (first) document.getElementById("example-hack").href = new URL(first.url, res.url).href;
  } catch {}
})();
</script>
</body>
</html>
`;
}
