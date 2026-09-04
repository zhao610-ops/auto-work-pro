import type { LLMProvider } from "@src/core/ports/llm.ts";
import type { ArticlePlan } from "@src/features/weixin-article/domain/article-plan.ts";
import type { WeixinTemplate } from "@src/features/weixin-article/domain/renderable-article.ts";
import type { PromptProfileName } from "@src/prompts/prompt-profile.ts";
import { createStructuredJsonCompletion } from "@src/utils/llm-structured-output.ts";
import { stripThinkTags } from "@src/utils/llm-output.ts";
import { Logger } from "@zilla/logger";
import { ARTICLE_LLM_TIMEOUT_MS } from "@src/features/weixin-article/services/article-llm-budget.ts";

const logger = new Logger("weixin-article-draft-service");

interface RawArticleDraft {
  articles?: unknown;
  notes?: unknown;
}

interface RawDraftArticle {
  id?: unknown;
  title?: unknown;
  content?: unknown;
}

export class WeixinArticleDraftService {
  constructor(
    private readonly llm: LLMProvider,
    private readonly promptProfile?: PromptProfileName,
  ) {}

  async draftTemplateData(
    templateData: WeixinTemplate[],
    articlePlan: ArticlePlan,
  ): Promise<WeixinTemplate[]> {
    if (!shouldDraft(articlePlan) || !templateData.length) return templateData;

    try {
      return await createStructuredJsonCompletion<
        RawArticleDraft,
        WeixinTemplate[]
      >({
        label: "文章正文起草",
        llm: this.llm,
        messages: [
          {
            role: "system",
            content: getDraftSystemPrompt(this.promptProfile),
          },
          {
            role: "user",
            content: getDraftUserPrompt(templateData, articlePlan),
          },
        ],
        chatOptions: {
          temperature: 0.35,
          max_tokens: 5200,
          timeoutMs: ARTICLE_LLM_TIMEOUT_MS.draft,
          maxAttempts: 2,
          response_format: { type: "json_object" },
        },
        maxAttempts: 2,
        normalize: (raw) => normalizeDraft(raw, templateData),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[正文起草] AI 生成失败，使用本地正文兜底: ${message}`);
      return templateData.map(sanitizeFallbackTemplateItem);
    }
  }
}

export function shouldDraft(articlePlan: ArticlePlan): boolean {
  return articlePlan.sections.length > 0;
}

function normalizeDraft(
  raw: RawArticleDraft,
  fallback: WeixinTemplate[],
): WeixinTemplate[] {
  if (!Array.isArray(raw.articles)) {
    throw new Error("正文起草结果缺少 articles 数组");
  }
  const fallbackById = new Map(fallback.map((item) => [item.id, item]));
  const drafted = raw.articles.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as RawDraftArticle;
    const id = stringValue(record.id);
    if (!id || !fallbackById.has(id)) return [];
    const source = fallbackById.get(id)!;
    const title = stringValue(record.title) ?? source.title;
    const sourceText = stringValue(source.metadata.sourceExcerptText) ??
      source.content;
    const content = normalizeContent(record.content, sourceText);
    if (!content) return [];
    return [{
      ...source,
      title,
      content,
    }];
  });

  const draftedById = new Map(drafted.map((item) => [item.id, item]));
  return fallback.map((item) =>
    draftedById.get(item.id) ?? sanitizeFallbackTemplateItem(item)
  );
}

function normalizeContent(
  value: unknown,
  sourceText: string,
): string | undefined {
  const text = Array.isArray(value)
    ? value.map(stringValue).filter(Boolean).join("<next_paragraph />")
    : stringValue(value);
  if (!text) return undefined;
  const normalized = stripThinkTags(text)
    .replace(/<\/?p[^>]*>/gi, "<next_paragraph />")
    .replace(/\n{2,}/g, "<next_paragraph />")
    .replace(/\s*<next_paragraph\s*\/>\s*/g, "<next_paragraph />")
    .trim();
  const sanitized = stripInternalDraftLabels(normalized) ||
    sourceTextToParagraphs(sourceText);
  return dropUnsupportedEntityParagraphs(sanitized, sourceText);
}

function sanitizeFallbackTemplateItem(item: WeixinTemplate): WeixinTemplate {
  if (!containsInternalDraftLabel(item.content)) return item;
  const sourceText = stringValue(item.metadata.sourceExcerptText);
  const content = sourceText
    ? sourceTextToParagraphs(sourceText)
    : stripInternalDraftLabels(item.content);
  return {
    ...item,
    content: content || "来源信息不足，建议查阅原文后再做判断。",
  };
}

function containsInternalDraftLabel(content: string): boolean {
  return /章节目标|写作角度|待核对编辑要点|可引用来源要点|仅作编辑目标|必须由来源支持/u
    .test(content);
}

function sourceTextToParagraphs(sourceText: string): string {
  return sourceText
    .split(/\n{2,}|<next_paragraph\s*\/>/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part.length > 260 ? `${part.slice(0, 260)}...` : part)
    .join("<next_paragraph />");
}

function stripInternalDraftLabels(content: string): string {
  return content
    .split(/<next_paragraph\s*\/>|\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      if (
        /章节目标|写作角度|待核对编辑要点|仅作编辑目标|必须由来源支持/u
          .test(part)
      ) {
        return [];
      }
      return [part.replace(/^可引用来源要点[:：]\s*/u, "").trim()];
    })
    .filter(Boolean)
    .join("<next_paragraph />");
}

function getDraftSystemPrompt(promptProfile?: PromptProfileName): string {
  return [
    "你是微信公众号资深编辑，负责把文章计划改写成读者可直接阅读的正文。",
    "输出必须是 JSON，不要 Markdown，不要解释。",
    "只允许使用输入中的事实、来源摘要和章节要点。不能新增事实，不能把未披露的信息写成确定事实。",
    "章节标题、章节目标、写作角度、待核对编辑要点都只是编辑计划，不是事实证据。事实只能来自“可引用来源要点”和 sourceUrls 指向的材料。",
    "商业状态、定价、付费/免费、API 是否开放、deprecated/legacy、替代关系、发布时间、参数规格，只有来源明确写出时才能确定表述。",
    "如果编辑计划里的措辞与来源要点冲突，必须以来源为准，并主动把章节标题和正文改成更保守的表述。",
    "如果某个信息没有来源支持，要写成“官方暂未披露”“还需要看后续文档确认”，不要编造 API、价格、参数、发布日期。",
    "每个章节输出 2-4 段自然中文正文，段落之间用 <next_paragraph /> 分隔。",
    "不要输出编辑意图句，比如“本段要说明”“需要回答”。",
    "不要输出清单式占位符；如果需要清单，每一点都要有判断或解释。",
    promptProfile ? `当前提示词风格：${promptProfile}` : "",
  ].filter(Boolean).join("\n");
}

function getDraftUserPrompt(
  templateData: WeixinTemplate[],
  articlePlan: ArticlePlan,
): string {
  return JSON.stringify({
    outputContract: {
      articles: [{
        id: "必须等于输入 section id",
        title: "可优化，但必须贴合章节",
        content: "2-4 段读者可读正文，用 <next_paragraph /> 分隔",
      }],
    },
    articlePlan: {
      format: articlePlan.format,
      thesis: articlePlan.thesis,
      targetReader: articlePlan.targetReader,
      summary: articlePlan.summary,
      riskNotes: articlePlan.riskNotes,
      sections: articlePlan.sections,
    },
    sectionInputs: templateData.map((item) => ({
      id: item.id,
      title: item.title,
      draftHintsAndSourceExcerpts: item.content,
      sourceUrls: item.metadata.sourceUrls ?? [item.url].filter(Boolean),
      sourceArticleIds: item.metadata.sourceArticleIds,
    })),
  });
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function dropUnsupportedEntityParagraphs(
  content: string,
  sourceText: string,
): string {
  const normalizedSource = sourceText.toLowerCase();
  const kept = content.split("<next_paragraph />").map((part) => part.trim())
    .filter(Boolean)
    .map((paragraph) =>
      removeUnsupportedEntitySentences(paragraph, normalizedSource)
    )
    .filter(Boolean);
  return kept.length ? kept.join("<next_paragraph />") : content;
}

function removeUnsupportedEntitySentences(
  paragraph: string,
  normalizedSource: string,
): string {
  const sentences = paragraph.match(/[^。！？!?；;]+[。！？!?；;]?/g) ?? [
    paragraph,
  ];
  return sentences
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter((sentence) =>
      !containsUnsupportedEntity(sentence, normalizedSource)
    )
    .join("")
    .trim();
}

function containsUnsupportedEntity(
  paragraph: string,
  normalizedSource: string,
): boolean {
  const normalizedParagraph = paragraph.toLowerCase();
  return entityGroundingRules.some((rule) =>
    rule.pattern.test(normalizedParagraph) &&
    !rule.pattern.test(normalizedSource)
  );
}

const entityGroundingRules: Array<{ label: string; pattern: RegExp }> = [
  { label: "OpenAI", pattern: /\bopenai\b/i },
  { label: "Codex", pattern: /\bcodex\b/i },
  { label: "Anthropic", pattern: /\banthropic\b/i },
  { label: "Claude", pattern: /\bclaude\b/i },
  { label: "Opus 4.7", pattern: /\bopus\s*4\.7\b/i },
  { label: "200K token", pattern: /\b200\s*k\s*(?:token|tokens)?\b/i },
  { label: "Google", pattern: /\bgoogle\b/i },
  { label: "DeepMind", pattern: /\bdeepmind\b/i },
  { label: "Gemini", pattern: /\bgemini\b/i },
  { label: "Gemma", pattern: /\bgemma\b/i },
  { label: "Meta", pattern: /\bmeta\b/i },
  { label: "Muse Spark", pattern: /\bmuse\s+spark\b/i },
  { label: "Co-Scientist", pattern: /\bco-scientist\b/i },
  { label: "MTIA", pattern: /\bmtia\b/i },
  { label: "SAM", pattern: /\bsam\s*\d*(?:\.\d+)?\b/i },
];
