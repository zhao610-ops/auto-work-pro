import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { LLMProvider } from "@src/core/ports/llm.ts";
import {
  ArticleRevisionChange,
  ArticleRevisionField,
  ArticleRevisionResult,
} from "@src/features/weixin-article/domain/article-revision.ts";
import type { ArticlePlan } from "@src/features/weixin-article/domain/article-plan.ts";
import type { ArticleQualityReview } from "@src/features/weixin-article/domain/quality-review.ts";
import { postProcessDynamicHtml } from "@src/features/weixin-article/rendering/dynamic/html-post-processor.ts";
import { ARTICLE_LLM_TIMEOUT_MS } from "@src/features/weixin-article/services/article-llm-budget.ts";
import {
  getArticleRevisionSystemPrompt,
  getArticleRevisionUserPrompt,
} from "@src/prompts/article-revision.prompt.ts";
import type { PromptProfileName } from "@src/prompts/prompt-profile.ts";
import { createStructuredJsonCompletion } from "@src/utils/llm-structured-output.ts";
import { cleanLLMText } from "@src/utils/llm-output.ts";
import { Logger } from "@zilla/logger";

const logger = new Logger("weixin-article-revision-service");

interface RawArticleRevision {
  applied?: unknown;
  title?: unknown;
  html?: unknown;
  changes?: unknown;
  skippedIssueIds?: unknown;
  notes?: unknown;
}

export class WeixinArticleRevisionService {
  constructor(
    private readonly llm: LLMProvider,
    private readonly promptProfile?: PromptProfileName,
  ) {}

  async reviseArticle(input: {
    round: number;
    title: string;
    html: string;
    articlePlan: ArticlePlan;
    qualityReview: ArticleQualityReview;
    contents: ScrapedContent[];
  }): Promise<ArticleRevisionResult> {
    const autoFixableIssues = input.qualityReview.issues.filter((issue) =>
      isSafeRevisionCandidate(issue)
    );
    if (!autoFixableIssues.length) {
      return createNoopRevision(input, false, "没有可安全自动修复的问题");
    }

    try {
      const messages = [
        {
          role: "system" as const,
          content: getArticleRevisionSystemPrompt(this.promptProfile),
        },
        {
          role: "user" as const,
          content: getArticleRevisionUserPrompt(input, this.promptProfile),
        },
      ];
      return await createStructuredJsonCompletion<
        RawArticleRevision,
        ArticleRevisionResult
      >({
        label: "文章修复",
        llm: this.llm,
        messages,
        chatOptions: {
          temperature: 0.25,
          max_tokens: 5200,
          timeoutMs: ARTICLE_LLM_TIMEOUT_MS.revision,
          maxAttempts: 2,
          response_format: { type: "json_object" },
        },
        maxAttempts: 2,
        normalize: (raw) => normalizeArticleRevision(raw, input, false),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[文章修复] AI 修复失败，保留原文: ${message}`);
      return createNoopRevision(input, true, message);
    }
  }
}

function isSafeRevisionCandidate(
  issue: ArticleQualityReview["issues"][number],
): boolean {
  if (issue.severity === "blocker") return false;
  if (issue.autoFixable) return true;
  return issue.category === "title" ||
    issue.category === "tone" ||
    issue.category === "structure" ||
    issue.category === "html";
}

export function normalizeArticleRevision(
  raw: RawArticleRevision,
  input: {
    round: number;
    title: string;
    html: string;
    qualityReview: ArticleQualityReview;
  },
  fallback: boolean,
  error?: string,
): ArticleRevisionResult {
  const applied = raw.applied === true;
  if (!applied) {
    return createNoopRevision(input, fallback, error, stringValue(raw.notes));
  }

  const title = normalizeTitle(raw.title, input.title);
  const html = normalizeHtml(raw.html, input.html);
  const changes = normalizeChanges(raw.changes);
  const changedFields = readChangedFields(input.title, title, input.html, html);
  const skippedIssueIds = stringArray(raw.skippedIssueIds);

  return {
    generatedAt: new Date().toISOString(),
    round: input.round,
    applied: changedFields.length > 0,
    changedFields,
    title,
    html,
    changes,
    skippedIssueIds,
    notes: stringValue(raw.notes),
    fallback,
    error,
  };
}

function createNoopRevision(
  input: { round: number; title: string; html: string },
  fallback: boolean,
  error?: string,
  notes?: string,
): ArticleRevisionResult {
  return {
    generatedAt: new Date().toISOString(),
    round: input.round,
    applied: false,
    changedFields: [],
    title: input.title,
    html: input.html,
    changes: [],
    skippedIssueIds: [],
    notes,
    fallback,
    error,
  };
}

function normalizeTitle(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const title = cleanLLMText(value)
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^(标题|主标题|建议标题|文章标题)\s*[:：]\s*/i, "")
        .replace(/^["'“”‘’]+|["'“”‘’。]+$/g, "")
        .trim()
    )
    .filter(Boolean)
    .at(-1) ?? "";
  return title
    ? title.replace(/[。.!！?？]+$/g, "").trim().slice(0, 60)
    : fallback;
}

function normalizeHtml(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  if (value.trim() === fallback.trim()) return fallback;
  try {
    return postProcessDynamicHtml(value).html;
  } catch {
    return fallback;
  }
}

function normalizeChanges(value: unknown): ArticleRevisionChange[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const issueId = stringValue(record.issueId);
    const field = readField(record.field);
    const before = stringValue(record.before);
    const after = stringValue(record.after);
    const reason = stringValue(record.reason);
    if (!issueId || !field || !before || !after || !reason) return [];
    return [{ issueId, field, before, after, reason }];
  }).slice(0, 12);
}

function readChangedFields(
  oldTitle: string,
  newTitle: string,
  oldHtml: string,
  newHtml: string,
): ArticleRevisionField[] {
  const fields: ArticleRevisionField[] = [];
  if (oldTitle.trim() !== newTitle.trim()) fields.push("title");
  if (oldHtml.trim() !== newHtml.trim()) fields.push("html");
  return fields;
}

function readField(value: unknown): ArticleRevisionField | undefined {
  return value === "title" || value === "html" ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const text = stringValue(item);
    return text ? [text] : [];
  });
}
