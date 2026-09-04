const ROOT_STYLE =
  "margin:0 auto;max-width:100%;padding:22px 18px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;color:#222222;background:#ffffff;line-height:1.9;";

const LIST_ITEM_STYLE =
  "margin:8px 0;padding-left:12px;border-left:2px solid #111111;font-size:15px;line-height:1.85;color:#333333;";

const FOOTNOTE_SECTION_STYLE =
  "margin:36px 0 0;padding-top:14px;border-top:1px solid #eeeeee;color:#777777;font-size:12px;line-height:1.7;";

const FOOTNOTE_ITEM_STYLE =
  "margin:6px 0;color:#777777;font-size:12px;line-height:1.7;";

const IMAGE_STYLE =
  "max-width:100%;display:block;margin:22px auto;border-radius:4px;height:auto;";

export interface DynamicHtmlPostProcessResult {
  html: string;
  footnotes: string[];
}

export function postProcessDynamicHtml(
  input: string,
): DynamicHtmlPostProcessResult {
  let html = stripMarkdownFence(input).trim();
  html = stripDocumentShell(html);
  html = stripHtmlComments(html);
  html = removeBannedBlocks(html);
  html = convertDivToSection(html);
  html = convertListsToSections(html);
  html = sanitizeAttributes(html);
  html = sanitizeImages(html);

  const linkResult = convertLinksToFootnotes(html);
  html = linkResult.html;
  html = fixTextSegments(html);
  html = fixStrongPunctuation(html);
  html = ensureRootStyle(html);
  html = appendFootnotes(html, linkResult.footnotes);
  validateWeixinHtml(html);

  return {
    html,
    footnotes: linkResult.footnotes,
  };
}

export { stripMarkdownFence };

function stripDocumentShell(input: string): string {
  return input
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<\/?html\b[^>]*>/gi, "")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<\/?body\b[^>]*>/gi, "")
    .trim();
}

function removeBannedBlocks(input: string): string {
  return input
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "");
}

function stripHtmlComments(input: string): string {
  return input.replace(/<!--[\s\S]*?-->/g, "");
}

function convertDivToSection(input: string): string {
  return input
    .replace(/<div\b/gi, "<section")
    .replace(/<\/div>/gi, "</section>");
}

function convertListsToSections(input: string): string {
  return input
    .replace(/<ul\b[^>]*>/gi, '<section style="margin:14px 0;padding:0;">')
    .replace(/<\/ul>/gi, "</section>")
    .replace(/<ol\b[^>]*>/gi, '<section style="margin:14px 0;padding:0;">')
    .replace(/<\/ol>/gi, "</section>")
    .replace(/<li\b[^>]*>/gi, `<p style="${LIST_ITEM_STYLE}">`)
    .replace(/<\/li>/gi, "</p>");
}

function sanitizeAttributes(input: string): string {
  return input
    .replace(/\s(?:class|id|name|data-[\w-]+)=(["']).*?\1/gi, "")
    .replace(/\son[a-z]+=(["']).*?\1/gi, "")
    .replace(/\s(?:class|id|name|data-[\w-]+|on[a-z]+)=[^\s>]+/gi, "");
}

function sanitizeImages(input: string): string {
  return input.replace(/<img\b([^>]*)\/?>/gi, (_match, attrs: string) => {
    const src = extractAttribute(attrs, "src");
    if (!src) {
      return "";
    }
    const alt = extractAttribute(attrs, "alt") || "文章配图";
    return `<img src="${escapeAttribute(src)}" alt="${
      escapeAttribute(alt)
    }" style="${IMAGE_STYLE}" />`;
  });
}

function convertLinksToFootnotes(
  input: string,
): { html: string; footnotes: string[] } {
  const footnotes: string[] = [];
  const html = input.replace(
    /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
    (_match, _quote: string, href: string, text: string) => {
      const index = footnotes.length + 1;
      footnotes.push(href);
      return `${text}<sup style="font-size:11px;color:#888888;">[${index}]</sup>`;
    },
  );

  return { html, footnotes };
}

function appendFootnotes(input: string, footnotes: string[]): string {
  if (footnotes.length === 0) {
    return input;
  }

  const items = footnotes.map((href, index) =>
    `<p style="${FOOTNOTE_ITEM_STYLE}">[${index + 1}] ${escapeHtml(href)}</p>`
  ).join("");
  const section =
    `<section style="${FOOTNOTE_SECTION_STYLE}"><p style="margin:0 0 8px;color:#555555;font-size:13px;font-weight:700;">参考链接</p>${items}</section>`;

  return input.replace(/<\/section>\s*$/i, `${section}</section>`);
}

function fixTextSegments(input: string): string {
  return input.split(/(<[^>]+>)/g).map((segment) => {
    if (segment.startsWith("<")) {
      return segment;
    }
    return fixCjkSpacing(segment);
  }).join("");
}

function fixCjkSpacing(input: string): string {
  return input
    .replace(/([\u4e00-\u9fff])([A-Za-z0-9])/g, "$1 $2")
    .replace(/([A-Za-z0-9])([\u4e00-\u9fff])/g, "$1 $2");
}

function fixStrongPunctuation(input: string): string {
  return input.replace(
    /<strong([^>]*)>([^<]*?)([，。！？；：、])<\/strong>/g,
    "<strong$1>$2</strong>$3",
  );
}

function ensureRootStyle(input: string): string {
  const html = input.trim();
  if (!/^<section\b/i.test(html)) {
    throw new Error("动态 HTML 根节点必须是 section");
  }

  return html.replace(/^<section\b([^>]*)>/i, (_match, attrs: string) => {
    const style = extractAttribute(attrs, "style");
    const cleanAttrs = attrs.replace(/\sstyle=(["']).*?\1/i, "");
    return `<section${cleanAttrs} style="${mergeStyle(ROOT_STYLE, style)}">`;
  });
}

function validateWeixinHtml(input: string): void {
  const html = input.trim();
  if (!html) {
    throw new Error("动态 HTML 为空");
  }
  if (!/^<section\b/i.test(html)) {
    throw new Error("动态 HTML 根节点必须是 section");
  }
  if (/<\/?(?:html|head|body|style|script|svg|div)\b/i.test(html)) {
    throw new Error("动态 HTML 包含不兼容标签");
  }
  if (/\s(?:class|id|on[a-z]+)=/i.test(html)) {
    throw new Error("动态 HTML 包含不兼容属性");
  }
}

function extractAttribute(attrs: string, name: string): string | undefined {
  const quoted = new RegExp(`${name}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(attrs);
  if (quoted) {
    return quoted[2];
  }
  const unquoted = new RegExp(`${name}\\s*=\\s*([^\\s>]+)`, "i").exec(attrs);
  return unquoted?.[1];
}

function mergeStyle(base: string, extra?: string): string {
  if (!extra) {
    return base;
  }
  const seen = new Set<string>();
  const declarations = [...splitStyle(base), ...splitStyle(extra)]
    .filter((declaration) => {
      const key = declaration.split(":")[0]?.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return declarations.join(";") + ";";
}

function splitStyle(style: string): string[] {
  return style
    .split(";")
    .map((item) => item.trim())
    .filter((item) => item.includes(":"));
}

function escapeAttribute(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
import { stripMarkdownFence } from "@src/utils/llm-output.ts";
