import type { LLMProvider } from "@src/core/ports/llm.ts";
import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { EvidencePack } from "@src/features/weixin-article/domain/evidence.ts";
import { postProcessDynamicHtml } from "@src/features/weixin-article/rendering/dynamic/html-post-processor.ts";
import { ARTICLE_LLM_TIMEOUT_MS } from "@src/features/weixin-article/services/article-llm-budget.ts";
import { inspectContentSafety } from "@src/features/weixin-article/services/content-safety-filter.service.ts";
import { createStructuredJsonCompletion } from "@src/utils/llm-structured-output.ts";
import { cleanLLMText } from "@src/utils/llm-output.ts";
import { Logger } from "@zilla/logger";

const logger = new Logger("toutiao-connected-rewrite-service");

interface RawToutiaoConnectedRewrite {
  title?: unknown;
  summary?: unknown;
  html?: unknown;
  verificationNotes?: unknown;
  removedOrWeakenedClaims?: unknown;
}

export interface ToutiaoConnectedRewriteResult {
  generatedAt: string;
  ready: boolean;
  title: string;
  summary: string;
  html: string;
  networkEvidenceCount: number;
  sourceUrls: string[];
  verificationNotes: string[];
  removedOrWeakenedClaims: string[];
  safetyPassed: boolean;
  fallback: boolean;
  error?: string;
}

export class ToutiaoConnectedRewriteService {
  constructor(private readonly llm: LLMProvider) {}

  async rewrite(input: {
    title: string;
    html: string;
    contents: ScrapedContent[];
    evidencePack: EvidencePack;
  }): Promise<ToutiaoConnectedRewriteResult> {
    const evidenceItems = input.evidencePack.items
      .filter((item) => item.confidence !== "low")
      .slice(0, 8);
    const sourceUrls = [
      ...new Set([
        ...input.contents.map((item) => item.url),
        ...evidenceItems.map((item) => item.url),
      ]),
    ].filter(isHttpUrl).slice(0, 16);
    try {
      const result = await createStructuredJsonCompletion<
        RawToutiaoConnectedRewrite,
        ToutiaoConnectedRewriteResult
      >({
        label: "头条联网校正重写",
        llm: this.llm,
        messages: [
          {
            role: "system",
            content: getSystemPrompt(),
          },
          {
            role: "user",
            content: getUserPrompt(input, evidenceItems),
          },
        ],
        chatOptions: {
          temperature: 0.2,
          max_tokens: 6000,
          timeoutMs: ARTICLE_LLM_TIMEOUT_MS.revision,
          maxAttempts: 2,
          response_format: { type: "json_object" },
        },
        maxAttempts: 2,
        normalize: (raw) =>
          normalizeRewrite(raw, sourceUrls, evidenceItems.length),
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[头条联网校正重写] 生成失败，停止头条发布: ${message}`);
      return {
        generatedAt: new Date().toISOString(),
        ready: false,
        title: input.title,
        summary: "",
        html: input.html,
        networkEvidenceCount: evidenceItems.length,
        sourceUrls,
        verificationNotes: [],
        removedOrWeakenedClaims: [],
        safetyPassed: false,
        fallback: true,
        error: message,
      };
    }
  }
}

function getSystemPrompt(): string {
  return `你是面向今日头条的中文商业编辑，负责一次性完成“联网资料真实性校正 + 合规重写”。

这不是规避平台审核，而是把文章改成准确、原创、可长期阅读的企业经营与行业分析。

真实性处理规则：
1. 只能使用输入的来源文章和联网证据，不得声称访问了输入之外的网页。
2. 有官方材料或两个相互独立来源支持的事实可以保留。
3. 只有一个来源支持的事实必须明确归因，例如“据 ASML 披露”或“据某媒体报道”。
4. 找不到支持、来源冲突或口径不清的数字和绝对结论，直接删除或改成有边界的审慎表述。
5. 不得把“收入占比为零”改写成“没有卖出一台”，不得把预测写成既成事实。

头条内容规则：
1. 不写突发新闻、快讯或国际政治评论，改成企业经营数据复盘、行业结构分析和岗位方法论。
2. 标题 5-30 个中文字符，准确具体，不使用“一台都卖不出、震动、失控、全面崩盘”等绝对化或煽动性表达。
3. 聚焦市场、品牌、产品企划、用户研究和管理层可以使用的判断，不给投资、医疗或法律建议。
4. 禁止政治、军事、违法、暴力、谣言、投资诱导、医疗建议和商业软文。
5. 保留原文中与正文相关的图片标签和图片来源说明，不新增图片链接。
6. HTML 根节点必须是 section；禁止 html、head、body、style、script、svg、iframe、class、id 和事件属性。
7. 只返回 JSON，不要 Markdown 或解释文字。

JSON 格式：
{
  "title": "文章标题",
  "summary": "80字以内摘要",
  "html": "完整正文HTML",
  "verificationNotes": ["内部真实性处理说明，不会发布"],
  "removedOrWeakenedClaims": ["删除或弱化的结论"]
}`;
}

function getUserPrompt(
  input: {
    title: string;
    html: string;
    contents: ScrapedContent[];
    evidencePack: EvidencePack;
  },
  evidenceItems: EvidencePack["items"],
): string {
  const contents = input.contents.slice(0, 8).map((item) => ({
    title: item.title,
    url: item.url,
    publishDate: item.publishDate,
    excerpt: stripHtml(item.content).slice(0, 1200),
  }));
  const evidence = evidenceItems.map((item) => ({
    title: item.title,
    url: item.url,
    sourceType: item.sourceType,
    confidence: item.confidence,
    summary: item.summary.slice(0, 900),
    supports: item.supports,
  }));
  return `请对下面文章执行一次性联网真实性校正与合规重写。

原标题：
${input.title}

来源文章：
${JSON.stringify(contents, null, 2)}

联网补充证据：
${JSON.stringify(evidence, null, 2)}

联网检索缺口：
${JSON.stringify(input.evidencePack.gaps.slice(0, 8), null, 2)}

当前正文 HTML：
${input.html.slice(0, 22000)}`;
}

function normalizeRewrite(
  raw: RawToutiaoConnectedRewrite,
  sourceUrls: string[],
  networkEvidenceCount: number,
): ToutiaoConnectedRewriteResult {
  const title = normalizeTitle(raw.title);
  const summary = normalizeText(raw.summary, 120);
  if (!title || title.length < 5 || title.length > 30) {
    throw new Error("头条重写标题长度必须为 5-30 个字符");
  }
  if (!summary) throw new Error("头条重写缺少摘要");
  if (typeof raw.html !== "string" || !raw.html.trim()) {
    throw new Error("头条重写缺少 HTML 正文");
  }
  const html = postProcessDynamicHtml(raw.html).html;
  if (stripHtml(html).length < 500) {
    throw new Error("头条重写正文过短");
  }
  const safety = inspectContentSafety({ title, content: html });
  return {
    generatedAt: new Date().toISOString(),
    ready: safety.passed,
    title,
    summary,
    html,
    networkEvidenceCount,
    sourceUrls,
    verificationNotes: normalizeStringArray(raw.verificationNotes),
    removedOrWeakenedClaims: normalizeStringArray(raw.removedOrWeakenedClaims),
    safetyPassed: safety.passed,
    fallback: false,
    ...(safety.passed ? {} : {
      error: `重写稿命中内容门禁：${
        safety.matches.map((item) => item.categoryLabel).join("、")
      }`,
    }),
  };
}

function normalizeTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  return cleanLLMText(value)
    .replace(/^(?:标题|文章标题)\s*[:：]\s*/u, "")
    .replace(/^[《“\"']+|[》”\"'。！？!?]+$/g, "")
    .trim();
}

function normalizeText(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  return cleanLLMText(value).replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const text = normalizeText(item, 240);
    return text ? [text] : [];
  }).slice(0, 12);
}

function stripHtml(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
