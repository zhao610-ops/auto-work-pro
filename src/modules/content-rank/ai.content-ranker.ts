import { RetryUtil } from "@src/utils/retry.util.ts";
import { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import { ChatMessage, LLMProvider } from "@src/core/ports/llm.ts";
import {
  getSystemPrompt,
  getUserPrompt,
} from "@src/prompts/content-ranker.prompt.ts";
import { RankResult } from "@src/core/ports/content-ranker.ts";
import { Logger } from "@zilla/logger";
import { stripMarkdownFence } from "@src/utils/llm-output.ts";
import { PromptProfileName } from "@src/prompts/prompt-profile.ts";

const logger = new Logger("ai-content-ranker");
const LOCAL_FALLBACK_WARNING = "[内容排序] AI 排序失败，使用本地可解释排序兜底";
const RANK_LLM_TIMEOUT_MS = 90_000;

export class ContentRanker {
  constructor(
    private readonly llmProvider: LLMProvider,
    private readonly promptProfile?: PromptProfileName,
  ) {
    logger.info("Ranker使用统一LLM配置");
  }

  public async rankContents(contents: ScrapedContent[]): Promise<RankResult[]> {
    if (!contents.length) {
      return [];
    }

    const result = await RetryUtil.retryOperationWithStats(
      async () => this.rankWithLLM(contents),
      {
        maxRetries: 0,
      },
    );

    if (result.success) {
      return result.result;
    }

    logger.warn(
      `${LOCAL_FALLBACK_WARNING}: ${result.error?.message ?? "未知错误"}`,
    );
    return rankContentsLocally(contents);
  }

  public async rankContentsBatch(
    contents: ScrapedContent[],
    batchSize: number = 5,
  ): Promise<RankResult[]> {
    const results: RankResult[] = [];

    for (let i = 0; i < contents.length; i += batchSize) {
      const batch = contents.slice(i, i + batchSize);
      const batchResults = await this.rankContents(batch);
      results.push(...batchResults);

      if (i + batchSize < contents.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    return results;
  }

  private async rankWithLLM(contents: ScrapedContent[]): Promise<RankResult[]> {
    const messages: ChatMessage[] = [
      { role: "system", content: getSystemPrompt(this.promptProfile) },
      {
        role: "user",
        content: getUserPrompt(contents, this.promptProfile),
      },
    ];

    const response = await this.llmProvider.createChatCompletion(messages, {
      timeoutMs: RANK_LLM_TIMEOUT_MS,
      maxAttempts: 1,
    });

    const result = response.choices?.[0]?.message?.content;
    if (!result) {
      throw new Error("未获取到有效的评分结果");
    }

    return parseRankingResult(result);
  }
}

export function rankContentsLocally(
  contents: ScrapedContent[],
  now: Date = new Date(),
): RankResult[] {
  return contents.map((content, index) => ({
    id: content.id,
    score: scoreContentLocally(content, now, index),
  }));
}

export function parseRankingResult(result: string): RankResult[] {
  const lines = stripReasoningContent(result)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const rankings = lines.flatMap((line) => {
    const parsed = parseRankingLine(line);
    return parsed ? [parsed] : [];
  });

  if (!rankings.length) {
    throw new Error(`未解析到有效的评分结果: ${result.slice(0, 200)}`);
  }

  return rankings;
}

function stripReasoningContent(result: string): string {
  let cleaned = stripMarkdownFence(result)
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "")
    .trim();

  const unclosedThinkIndex = cleaned.search(/<think\b[^>]*>/i);
  if (unclosedThinkIndex >= 0) {
    const afterThink = cleaned
      .slice(unclosedThinkIndex)
      .replace(/<think\b[^>]*>/i, "");
    const firstRankingLineIndex = afterThink
      .split("\n")
      .findIndex((line) => parseRankingLine(line.trim()) !== null);

    if (firstRankingLineIndex >= 0) {
      cleaned = afterThink.split("\n").slice(firstRankingLineIndex).join("\n");
    } else {
      cleaned = cleaned.slice(0, unclosedThinkIndex);
    }
  }

  return cleaned;
}

function parseRankingLine(line: string): RankResult | null {
  const cleanedLine = line
    .replace(/^[-*]\s*/, "")
    .replace(/^文章ID[:：]?\s*/i, "")
    .replace(/\s*分数[:：]\s*/i, " ")
    .trim();

  const match = cleanedLine.match(/^(\S+?)(?:[\s:：]+)(\d+(?:\.\d+)?)$/);

  if (!match) {
    return null;
  }

  const [, id, scoreStr] = match;
  const score = parseFloat(scoreStr);

  if (isNaN(score)) {
    return null;
  }

  return { id: id.replace(/[:：]$/, ""), score };
}

function scoreContentLocally(
  content: ScrapedContent,
  now: Date,
  index: number,
): number {
  const metadataScore = numberMetadata(content.metadata, "score");
  let score = metadataScore === undefined
    ? 52
    : 40 + clamp(metadataScore, 0, 100) * 0.35;

  score += recencyScore(content.publishDate, now);
  score += depthScore(content);
  score += sourceScore(content.url);
  score += titleScore(content.title);

  if (booleanMetadata(content.metadata, "requiresHydration")) {
    score -= 5;
  }
  if (booleanMetadata(content.metadata, "extractedFromListPage")) {
    score += 2;
  }
  if (isLikelyListPageContent(content)) {
    score -= 28;
  }
  if (content.media?.length) {
    score += Math.min(4, content.media.length);
  }

  score -= Math.min(index, 20) * 0.05;
  return Math.round(clamp(score, 1, 100) * 10) / 10;
}

function isLikelyListPageContent(content: ScrapedContent): boolean {
  if (booleanMetadata(content.metadata, "requiresHydration")) return false;

  const title = content.title.trim().toLowerCase();
  const genericTitle = /^(news|blog|updates?|openai news|anthropic news)$/i
    .test(title);
  const markdownLinkCount = (content.content.match(/\]\(https?:\/\//g) ?? [])
    .length;
  const imageCount = (content.content.match(/!\[[^\]]*]\(https?:\/\//g) ?? [])
    .length;
  let listPath = false;
  try {
    const url = new URL(content.url);
    listPath = /\/(news|blog|updates?|research)\/?$/i.test(url.pathname);
  } catch {
    listPath = false;
  }

  return (genericTitle || listPath) &&
    (markdownLinkCount >= 4 || imageCount >= 3);
}

function recencyScore(publishDate: string, now: Date): number {
  const date = new Date(publishDate);
  if (Number.isNaN(date.getTime())) return -4;

  const ageHours = (now.getTime() - date.getTime()) / 3_600_000;
  if (ageHours < -12) return -3;
  if (ageHours <= 24) return 18;
  if (ageHours <= 72) return 13;
  if (ageHours <= 168) return 7;
  if (ageHours <= 336) return 2;
  return -10;
}

function depthScore(content: ScrapedContent): number {
  const wordCount = numberMetadata(content.metadata, "wordCount") ??
    estimateWordCount(content.content);
  if (wordCount < 80) return -18;
  if (wordCount < 180) return -8;
  if (wordCount <= 1200) return 12;
  if (wordCount <= 5000) return 16;
  return 8;
}

function sourceScore(url: string): number {
  let hostname = "";
  try {
    hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return -4;
  }

  if (
    [
      "openai.com",
      "anthropic.com",
      "deepmind.google",
      "blog.google",
      "ai.meta.com",
      "huggingface.co",
      "microsoft.com",
      "github.com",
      "arxiv.org",
    ].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
  ) {
    return 10;
  }

  if (
    [
      "theverge.com",
      "techcrunch.com",
      "wired.com",
      "mit.edu",
      "nature.com",
      "science.org",
      "36kr.com",
      "qbitai.com",
    ].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
  ) {
    return 5;
  }

  if (hostname.includes("twitter.com") || hostname.includes("x.com")) {
    return 1;
  }

  return 0;
}

function titleScore(title: string): number {
  const normalized = title.trim();
  if (!normalized) return -12;
  if (normalized.length < 8) return -6;
  if (/[?？]$/.test(normalized)) return -2;
  if (
    /首页|新闻|博客|动态|latest|news/i.test(normalized) &&
    normalized.length < 18
  ) {
    return -8;
  }
  if (/震撼|炸裂|史上|王炸|杀疯|重磅/i.test(normalized)) return -5;
  return 6;
}

function estimateWordCount(text: string): number {
  const compact = text.trim();
  if (!compact) return 0;
  const cjkChars = compact.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const words = compact.match(/[A-Za-z0-9][A-Za-z0-9_-]*/g)?.length ?? 0;
  return cjkChars + words;
}

function numberMetadata(
  metadata: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = metadata[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function booleanMetadata(
  metadata: Record<string, unknown>,
  key: string,
): boolean {
  return metadata[key] === true;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
