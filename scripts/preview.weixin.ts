import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { postProcessDynamicHtml } from "@src/features/weixin-article/rendering/dynamic/html-post-processor.ts";
import { WeixinTemplate } from "@src/features/weixin-article/domain/renderable-article.ts";
import { formatDate } from "@src/utils/common.ts";
import ejs from "npm:ejs@3.1.10";

const PLACEHOLDER_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1200' height='675' viewBox='0 0 1200 675'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%23f8fafc'/%3E%3Cstop offset='1' stop-color='%23e5e7eb'/%3E%3C/linearGradient%3E%3ClinearGradient id='m' x1='0' y1='0' x2='1' y2='0'%3E%3Cstop offset='0' stop-color='%23bfdbfe'/%3E%3Cstop offset='1' stop-color='%23dbeafe'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='1200' height='675' fill='url(%23g)'/%3E%3Crect x='80' y='80' width='1040' height='515' rx='32' fill='%23ffffff' stroke='%23d1d5db' stroke-width='2'/%3E%3Ccircle cx='248' cy='226' r='62' fill='%23e5e7eb'/%3E%3Ccircle cx='330' cy='188' r='24' fill='%23dbeafe'/%3E%3Cpath d='M154 505L386 276l138 132 104-98 418 195H154z' fill='url(%23m)'/%3E%3Cpath d='M154 505L386 276l138 132 104-98 418 195' fill='none' stroke='%2393c5fd' stroke-width='8' stroke-linejoin='round'/%3E%3Crect x='700' y='180' width='290' height='28' rx='14' fill='%23e5e7eb'/%3E%3Crect x='700' y='235' width='390' height='22' rx='11' fill='%23eef2f7'/%3E%3Crect x='700' y='279' width='340' height='22' rx='11' fill='%23eef2f7'/%3E%3Crect x='700' y='323' width='250' height='22' rx='11' fill='%23eef2f7'/%3E%3C/svg%3E";

const previewArticles: WeixinTemplate[] = [
  {
    id: "1",
    title: "人工智能发展最新突破：GPT-4 展现多模态能力",
    content:
      `当你使用一个库时，它能够"即插即用"，这背后往往<strong>隐藏着一位工程师</strong>付出的巨大努力。编写高质量的技术文档是一项耗时且需要高度专业技能的工作。<next_paragraph />在软件开发领域，良好的文档可以显著提高开发效率，减少因理解错误导致的 bug。对于开源项目来说，优质的文档更是吸引贡献者和用户的关键因素之一。<next_paragraph />这种对细节的关注和对用户体验的重视体现了工程师的专业精神。`,
    url: "https://example.com/gpt4-breakthrough",
    publishDate: formatDate(new Date().toISOString()),
    keywords: ["GPT-4", "人工智能", "多模态", "OpenAI"],
    media: [{
      url: PLACEHOLDER_IMAGE,
      type: "image",
      size: { width: 1200, height: 675 },
    }],
    metadata: { author: "AI研究员", readTime: 5, wordCount: 1000 },
  },
  {
    id: "2",
    title: "开发者工具更新：更快的代码审查与自动修复",
    content:
      `新版本把代码审查、测试建议和修复说明放在同一个工作流里，适合团队在发布前快速定位风险。<next_paragraph />它不会替代人工判断，但可以减少重复检查，让工程师把时间放在接口契约、边界条件和用户体验上。<next_paragraph/><ul><li>识别潜在回归</li><li>生成测试建议</li><li>整理发布说明</li></ul>`,
    url: "https://example.com/dev-tool-update",
    publishDate: formatDate(new Date().toISOString()),
    keywords: ["开发工具", "代码审查", "自动化"],
    media: [{
      url: PLACEHOLDER_IMAGE,
      type: "image",
      size: { width: 1200, height: 675 },
    }],
    metadata: { author: "工具观察", readTime: 4, wordCount: 860 },
  },
  {
    id: "3",
    title: "模型产品化进入新阶段：从演示走向稳定交付",
    content:
      `越来越多团队开始把模型能力接入真实业务系统，关注点也从"效果惊艳"转向稳定性、成本和可观测性。<next_paragraph />这意味着产品设计需要更清晰地暴露模型边界，让用户知道哪些结果可信，哪些结果需要复核。`,
    url: "https://example.com/model-product",
    publishDate: formatDate(new Date().toISOString()),
    keywords: ["模型产品化", "AI 应用", "可观测性"],
    metadata: { author: "产品研究", readTime: 6, wordCount: 1200 },
  },
];

const templates: Record<string, string | null> = {
  default: "article.ejs",
  modern: "article.modern.ejs",
  tech: "article.tech.ejs",
  mianpro: "article.mianpro.ejs",
  longform: "article.longform.ejs",
  product: "article.product.ejs",
  minimal: "article.minimal.ejs",
  darktech: "article.darktech.ejs",
  dynamic: null,
};

export async function renderAndSaveWeixinPreview(
  outputDir = join(Deno.cwd(), "src/temp"),
): Promise<string[]> {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const articles = previewArticles.map((article) => ({
    ...article,
    content: normalizePreviewContent(article),
  }));

  const outputPaths: string[] = [];

  for (const [templateType, fileName] of Object.entries(templates)) {
    const html = fileName
      ? await renderEjsPreview(fileName, articles)
      : renderDynamicPreview(articles);
    const outputPath = join(outputDir, `preview_weixin_${templateType}.html`);
    writeFileSync(outputPath, wrapPreviewHtml(html), "utf-8");
    outputPaths.push(outputPath);
  }

  return outputPaths;
}

async function renderEjsPreview(
  fileName: string,
  articles: WeixinTemplate[],
): Promise<string> {
  const templatePath = join(
    Deno.cwd(),
    "src/features/weixin-article/rendering/templates",
    fileName,
  );
  const template = await Deno.readTextFile(templatePath);
  return ejs.render(template, { articles }, { rmWhitespace: true });
}

function renderDynamicPreview(articles: WeixinTemplate[]): string {
  const list = articles.map((article, index) =>
    `<p style="margin:8px 0;padding-bottom:8px;border-bottom:1px solid #eeeeee;color:#333333;font-size:14px;line-height:1.7;"><span style="color:#999999;margin-right:8px;">${
      (index + 1).toString().padStart(2, "0")
    }</span>${article.title}</p>`
  ).join("");

  const sections = articles.map((article, index) =>
    `<section style="margin:32px 0;"><p style="margin:0 0 8px;color:#888888;font-size:12px;font-weight:700;">DYNAMIC ${
      (index + 1).toString().padStart(2, "0")
    }</p><h3 style="margin:0 0 14px;color:#111111;font-size:22px;line-height:1.45;">${article.title}</h3><section style="margin:14px 0;padding:14px 16px;border-left:3px solid #111111;background:#f7f7f7;"><p style="margin:0;color:#333333;font-size:14px;line-height:1.8;">动态模板会根据文章内容实时生成整体排版，自动处理重点、图片、列表和来源脚注。</p></section>${article.content}</section>`
  ).join("");

  return postProcessDynamicHtml(
    `<section style="margin:0 auto;max-width:100%;padding:22px 18px;"><p style="margin:0 0 8px;color:#999999;font-size:12px;font-weight:700;">AI GENERATED</p><h2 style="margin:0 0 22px;color:#111111;font-size:25px;line-height:1.35;">动态排版预览</h2>${list}${sections}</section>`,
  ).html;
}

function normalizePreviewContent(article: WeixinTemplate): string {
  const content = article.content.replaceAll(
    "<next_paragraph/>",
    "<next_paragraph />",
  );

  if (!article.media || article.media.length === 0) {
    return content;
  }

  const paragraphs = content.split("<next_paragraph />");
  const mediaUrls = article.media.map((media) => media.url);
  let mediaIndex = 0;
  const processed: string[] = [];

  for (const paragraph of paragraphs) {
    if (mediaIndex < mediaUrls.length) {
      processed.push(`<img src="${mediaUrls[mediaIndex]}" alt="文章配图" />`);
      mediaIndex++;
    }
    processed.push(paragraph);
  }

  return processed.filter((item) => item.trim().length > 0).join(
    "<next_paragraph />",
  );
}

function wrapPreviewHtml(content: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>微信模板预览</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
    }
  </style>
</head>
<body>
${content}
</body>
</html>`;
}

if (import.meta.main) {
  const outputPaths = await renderAndSaveWeixinPreview();
  for (const outputPath of outputPaths) {
    console.log(`预览文件已生成：${outputPath}`);
  }
}
