import { compiledTemplates } from "./compiled.ts";

export type HackApprovedEmailVars = {
  title: string;
  slug: string;
};

export type HackReviewReplyEmailVars = {
  title: string;
  slug: string;
  message: string;
  adminName: string;
};

export type EmailTemplateVars = {
  announcement: { title: string; message: string };
  "hack-approved": HackApprovedEmailVars;
  "hack-review-reply": HackReviewReplyEmailVars;
};

export type EmailTemplate = keyof EmailTemplateVars;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function substituteVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = vars[key];
    if (value === undefined) {
      throw new Error(`Missing email template variable: ${key}`);
    }
    return value;
  });
}

// Escape announcement text; support HTTP links, Markdown images, and ## / ### headings.
function formatAnnouncementMessage(message: string): string {
  const html = message.split(/(!\[[^\]\r\n]*\]\(https?:\/\/[^\s<>"'()]+\)|https?:\/\/[^\s<>"']+)/g).map((part, index) => {
    if (index % 2 === 0) return escapeHtml(part);
    const image = part.match(/^!\[([^\]\r\n]*)\]\((https?:\/\/[^\s<>"'()]+)\)$/);
    if (image) {
      const src = escapeHtml(image[2]);
      return `<a href="${src}"><img src="${src}" alt="${escapeHtml(image[1])}" width="550" style="display:block;width:100%;max-width:550px;height:auto;border:0;" /></a>`;
    }
    const url = part.replace(/[.,;!?)]+$/, "");
    return `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>${escapeHtml(part.slice(url.length))}`;
  }).join("");

  return html.replace(/^(#{2,3})[ \t]+([^\r\n]+)\r?$/gm, (_, marks: string, text: string) => {
    const level = marks.length;
    const style = level === 2
      ? "font-size:20px;line-height:28px;margin:24px 0 12px;"
      : "font-size:16px;line-height:24px;margin:20px 0 8px;";
    return `<h${level} style="${style}font-weight:700;color:#171717;">${text}</h${level}>`;
  }).replace(/\r?\n/g, "<br />")
    .replace(/(?:<br \/>){1,2}(<h[23] )/g, "$1")
    .replace(/(<\/h[23]>)(?:<br \/>){1,2}/g, "$1");
}

const templateNormalizers: {
  [K in EmailTemplate]: (vars: EmailTemplateVars[K]) => Record<string, string>;
} = {
  announcement: ({ title, message }) => ({
    title: escapeHtml(title),
    message: formatAnnouncementMessage(message),
  }),
  "hack-approved": ({ title, slug }) => ({
    title: escapeHtml(title),
    slug: encodeURIComponent(slug),
  }),
  "hack-review-reply": ({ title, slug, message, adminName }) => ({
    title: escapeHtml(title),
    slug: encodeURIComponent(slug),
    message: escapeHtml(message).replace(/\r?\n/g, "<br />"),
    adminName: escapeHtml(adminName),
  }),
};

function normalizeTemplateVars<T extends EmailTemplate>(
  template: T,
  vars: EmailTemplateVars[T],
): Record<string, string> {
  return templateNormalizers[template](vars);
}

export async function renderEmail<T extends EmailTemplate>(
  template: T,
  vars: EmailTemplateVars[T],
): Promise<string> {
  return substituteVars(compiledTemplates[template], normalizeTemplateVars(template, vars));
}
