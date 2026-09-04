import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { EditorialDecision } from "@src/features/weixin-article/domain/editorial-decision.ts";
import type { EditorialTopicReport } from "@src/features/weixin-article/domain/editorial-topic.ts";
import type {
  ArticleContentFetcher,
  ArticleContentFetchFailure,
} from "@src/features/weixin-article/services/content-scrape.service.ts";
import type {
  EvidenceItem,
  EvidencePack,
  EvidenceSourceType,
} from "./types.ts";
import { Logger } from "@zilla/logger";

const logger = new Logger("article-quality-research");

export interface ResearchServiceOptions {
  maxResearchQueries: number;
  maxResultsPerQuery: number;
  searchProviders: string[];
}

export class ArticleQualityResearchService {
  constructor(
    private readonly contentFetcher: ArticleContentFetcher,
    private readonly options: ResearchServiceOptions,
  ) {}

  async createEvidencePack(input: {
    topicReport: EditorialTopicReport;
    editorialDecision: EditorialDecision;
    contents: ScrapedContent[];
  }): Promise<EvidencePack> {
    const queries = this.createQueries(input).slice(
      0,
      this.normalizeLimit(this.options.maxResearchQueries, 4, 8),
    );
    const items: EvidenceItem[] = [];
    const gaps: string[] = [];
    const seenUrls = new Set<string>();
    const resultLimit = this.normalizeLimit(
      this.options.maxResultsPerQuery,
      5,
      10,
    );

    for (const query of queries) {
      const failures: ArticleContentFetchFailure[] = [];
      try {
        const result = await this.contentFetcher.scrape(
          {
            raw: `search:${query}`,
            url: query,
            kind: "query",
            group: "search",
            providers: this.options.searchProviders,
          },
          (failure) => {
            failures.push(failure);
          },
        );
        const candidates = result.contents.slice(0, resultLimit);
        if (!candidates.length) {
          gaps.push(`搜索无结果: ${query}`);
          continue;
        }

        for (const candidate of candidates) {
          const hydrated = await this.hydrateCandidate(candidate);
          if (seenUrls.has(hydrated.url)) continue;
          seenUrls.add(hydrated.url);
          items.push(this.toEvidenceItem(hydrated, query));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failureMessage = failures.length
          ? `${message}; ${
            failures.map((item) => `${item.provider}: ${item.message}`).join(
              "; ",
            )
          }`
          : message;
        logger.warn(`[研究实验] 搜索失败: ${query} - ${failureMessage}`);
        gaps.push(`搜索失败: ${query} - ${failureMessage}`);
      }
    }

    const filteredItems = filterEvidenceItems(items);

    if (!filteredItems.length) {
      const reason = gaps.length ? gaps.join("\n") : "未获得任何补充证据";
      throw new Error(
        `文章质量实验无法生成 EvidencePack。请确认 search 抓取分组和对应 providers.fetch.* 凭证可用。\n${reason}`,
      );
    }

    return {
      topic: input.editorialDecision.leadTopicTitle ||
        input.topicReport.clusters[0]?.title ||
        "未命名选题",
      generatedAt: new Date().toISOString(),
      queries,
      items: filteredItems.slice(0, queries.length * resultLimit),
      gaps,
    };
  }

  toEvidenceContents(pack: EvidencePack): ScrapedContent[] {
    return pack.items.map((item, index) => ({
      id: `evidence_${index + 1}_${stableHash(item.url)}`,
      title: `补充证据：${item.title}`,
      content: [
        `来源类型：${item.sourceType}`,
        `可信度：${item.confidence}`,
        `支持观点：${item.supports.join("；")}`,
        `摘要：${item.summary}`,
        `原始链接：${item.url}`,
      ].join("\n"),
      url: item.url,
      publishDate: new Date().toISOString(),
      metadata: {
        source: "quality-experiment-evidence",
        provider: item.provider,
        sourceType: item.sourceType,
        confidence: item.confidence,
        supports: item.supports,
      },
    }));
  }

  private createQueries(input: {
    topicReport: EditorialTopicReport;
    editorialDecision: EditorialDecision;
    contents: ScrapedContent[];
  }): string[] {
    const clusterTitleById = new Map(
      input.topicReport.clusters.map((cluster) => [cluster.id, cluster.title]),
    );
    const sourceHosts = [
      ...new Set(
        input.contents.map((content) => readHost(content.url)).filter(
          Boolean,
        ),
      ),
    ].slice(0, 3);
    const values = [
      ...input.contents.slice(0, 3).map((content) =>
        `${content.title} ${sourceHosts[0] ?? ""}`
      ),
      input.editorialDecision.leadTopicTitle,
      `${input.editorialDecision.leadTopicTitle} ${
        sourceHosts.length ? sourceHosts.join(" ") : "official announcement"
      }`,
      ...input.editorialDecision.selectedTopics.map((topic) =>
        clusterTitleById.get(topic.topicId)
      ),
      ...input.topicReport.clusters
        .flatMap((cluster) => [
          cluster.title,
          cluster.keywords.slice(0, 3).join(" "),
        ]),
    ];

    const seen = new Set<string>();
    return values
      .map((value) => value?.replace(/\s+/g, " ").trim())
      .filter((value): value is string => Boolean(value && value.length >= 2))
      .filter((value) => {
        const key = value.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  private async hydrateCandidate(
    candidate: ScrapedContent,
  ): Promise<ScrapedContent> {
    if (!this.contentFetcher.hydrate) return candidate;
    try {
      const result = await this.contentFetcher.hydrate(candidate, (failure) => {
        logger.debug(
          `[研究实验] 证据深抓失败 ${candidate.url}: ${failure.provider} ${failure.message}`,
        );
      });
      return result.content;
    } catch (error) {
      logger.debug(
        `[研究实验] 证据深抓异常 ${candidate.url}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return candidate;
    }
  }

  private toEvidenceItem(content: ScrapedContent, query: string): EvidenceItem {
    const sourceType = inferSourceType(content.url);
    return {
      id: `ev_${stableHash(`${query}:${content.url}`)}`,
      title: content.title || content.url,
      url: content.url,
      provider: String(
        content.metadata.provider ?? content.metadata.source ?? "unknown",
      ),
      sourceType,
      summary: normalizeSummary(content.content),
      supports: [query],
      confidence: inferConfidence(sourceType),
    };
  }

  private normalizeLimit(value: number, fallback: number, max: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(1, Math.min(max, Math.floor(value)));
  }
}

function inferSourceType(url: string): EvidenceSourceType {
  const host = readHost(url);
  if (!host) return "background";
  if (
    host.endsWith(".gov") ||
    host.endsWith(".edu") ||
    host.includes("openai.com") ||
    host.includes("anthropic.com") ||
    host.includes("deepmind.google") ||
    host.includes("research.google") ||
    host.includes("blog.google") ||
    host.includes("googleblog.com") ||
    host.includes("microsoft.com") ||
    host.includes("github.com")
  ) {
    return "official";
  }
  if (
    host.includes("arxiv.org") ||
    host.includes("paperswithcode.com") ||
    host.includes("huggingface.co")
  ) {
    return "primary";
  }
  if (
    host.includes("x.com") ||
    host.includes("twitter.com") ||
    host.includes("reddit.com") ||
    host.includes("news.ycombinator.com")
  ) {
    return "community";
  }
  if (
    host.includes("techcrunch.com") ||
    host.includes("theverge.com") ||
    host.includes("wired.com") ||
    host.includes("36kr.com") ||
    host.includes("qbitai.com")
  ) {
    return "media";
  }
  return "background";
}

function filterEvidenceItems(items: EvidenceItem[]): EvidenceItem[] {
  return items.filter((item) => {
    if (item.summary.trim().length < 120) return false;
    if (item.confidence === "low" && item.sourceType === "background") {
      return false;
    }
    return true;
  });
}

function inferConfidence(
  sourceType: EvidenceSourceType,
): EvidenceItem["confidence"] {
  if (sourceType === "official" || sourceType === "primary") return "high";
  if (sourceType === "media" || sourceType === "community") return "medium";
  return "low";
}

function normalizeSummary(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 900);
}

function readHost(value: string): string | undefined {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function stableHash(value: string): string {
  let result = 0;
  for (let index = 0; index < value.length; index++) {
    result = ((result << 5) - result + value.charCodeAt(index)) | 0;
  }
  return Math.abs(result).toString(36);
}
