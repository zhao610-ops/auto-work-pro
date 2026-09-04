import { RankResult } from "@src/core/ports/content-ranker.ts";
import { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import { ContentSummarizer } from "@src/core/ports/content-summarizer.ts";
import { INotifier } from "@src/core/ports/notifier.ts";
import type { EditorialDecision } from "@src/features/weixin-article/domain/editorial-decision.ts";
import type { EditorialTopicReport } from "@src/features/weixin-article/domain/editorial-topic.ts";
import type {
  ArticleContentFetcher,
} from "@src/features/weixin-article/services/content-scrape.service.ts";
import { Logger } from "@zilla/logger";
import ProgressBar from "jsr:@deno-library/progress";

const logger = new Logger("weixin-article-process-service");

export interface ContentSelectionContext {
  topicReport?: EditorialTopicReport;
  editorialDecision?: EditorialDecision;
}

export class WeixinArticleContentProcessService {
  constructor(
    private readonly summarizer: ContentSummarizer,
    private readonly notifier: INotifier,
    private readonly defaultArticleCount: number,
    private readonly contentFetcher?: ArticleContentFetcher,
  ) {}

  async processTopRanked(
    rankedContents: RankResult[],
    sourceContents: ScrapedContent[],
    maxArticles?: number,
    selection?: ContentSelectionContext,
  ): Promise<ScrapedContent[]> {
    const limit = maxArticles || this.defaultArticleCount;

    const topContents = this.pickTopContents(
      rankedContents,
      sourceContents,
      limit,
      selection,
    );

    if (topContents.length < limit) {
      logger.warn(
        `[内容处理] 文章数量不足，期望 ${limit} 篇，实际 ${topContents.length} 篇`,
      );
      await this.notifier.warning(
        "内容数量不足",
        `仅获取到 ${topContents.length} 篇文章，少于预期的 ${limit} 篇`,
      );
    }

    logger.debug(
      "[内容处理] 开始处理文章",
      JSON.stringify(topContents, null, 2),
    );

    const processProgress = new ProgressBar({
      title: "内容处理进度",
      total: topContents.length,
      clear: true,
      display: ":title | :percent | :completed/:total | :time \n",
    });
    let processCompleted = 0;

    await Promise.all(topContents.map(async (content) => {
      await this.hydrateContent(content);
      await this.processContent(content);
      await processProgress.render(++processCompleted, {
        title: `已处理: ${content.title?.slice(0, 5) || "无标题"}...`,
      });
    }));

    return topContents;
  }

  private pickTopContents(
    rankedContents: RankResult[],
    sourceContents: ScrapedContent[],
    maxArticles: number,
    selection?: ContentSelectionContext,
  ): ScrapedContent[] {
    const topContents: ScrapedContent[] = [];
    const selectedIds = new Set<string>();
    const contentById = new Map(sourceContents.map((item) => [item.id, item]));
    const rankById = new Map(rankedContents.map((item) => [item.id, item]));

    const addContent = (id: string) => {
      if (topContents.length >= maxArticles || selectedIds.has(id)) return;
      const content = contentById.get(id);
      if (!content) return;
      selectedIds.add(id);
      const ranked = rankById.get(id);
      const wordCount = content.content.length;
      if (ranked) content.metadata.score = ranked.score;
      content.metadata.wordCount = wordCount;
      content.metadata.readTime = Math.ceil(wordCount / 275);
      topContents.push(content);
    };

    for (const id of this.pickDecisionArticleIds(selection, sourceContents)) {
      addContent(id);
    }

    for (const ranked of rankedContents) {
      addContent(ranked.id);
      if (topContents.length >= maxArticles) break;
    }

    return topContents;
  }

  private pickDecisionArticleIds(
    selection: ContentSelectionContext | undefined,
    sourceContents: ScrapedContent[],
  ): string[] {
    if (!selection?.topicReport || !selection.editorialDecision) return [];

    const ids: string[] = [];
    const seen = new Set<string>();
    const clusterById = new Map(
      selection.topicReport.clusters.map((cluster) => [cluster.id, cluster]),
    );
    const contentIdByUrl = new Map(sourceContents.map((item) => [
      item.url,
      item.id,
    ]));

    const add = (id?: string) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      ids.push(id);
    };

    const roleOrder = { lead: 0, supporting: 1, watch: 2 };
    const selectedTopics = [...selection.editorialDecision.selectedTopics]
      .sort((left, right) => roleOrder[left.role] - roleOrder[right.role]);
    for (const topic of selectedTopics) {
      const cluster = clusterById.get(topic.topicId);
      if (!cluster) continue;
      add(cluster.primaryArticleId);
      for (const id of cluster.articleIds) add(id);
    }

    for (const judgement of selection.editorialDecision.sourceJudgements) {
      if (
        judgement.role !== "primary" &&
        judgement.role !== "supporting"
      ) continue;
      add(contentIdByUrl.get(judgement.url));
    }

    return ids;
  }

  private async processContent(content: ScrapedContent): Promise<void> {
    try {
      const originalTitle = content.title;
      const originalContent = content.content;
      content.metadata.originalTitle ??= originalTitle;
      content.metadata.originalContentExcerpt ??= truncateText(
        originalContent,
        2400,
      );
      const summary = await this.summarizer.summarize(JSON.stringify(content));
      content.title = summary.title;
      content.content = summary.content;
      content.metadata.keywords = summary.keywords;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[内容处理] ${content.id} 处理失败:`, message);
      await this.notifier.warning(
        "内容处理失败",
        `ID: ${content.id}\n保留原始内容`,
      );
      content.title = content.title || "无标题";
      content.content = content.content || "内容处理失败";
      content.metadata.keywords = content.metadata.keywords || [];
    }
  }

  private async hydrateContent(content: ScrapedContent): Promise<void> {
    if (!this.contentFetcher?.hydrate) return;

    const result = await this.contentFetcher.hydrate(
      content,
      (failure) => {
        logger.warn(
          `[正文深抓] ${content.url} 使用 ${failure.provider} 失败: ${failure.message}`,
        );
      },
    );

    if (!result.hydrated) {
      logger.debug(
        `[正文深抓] 保留原始内容: ${content.url}, length=${result.originalContentLength}`,
      );
      return;
    }

    Object.assign(content, result.content);
    logger.info(
      `[正文深抓] ${content.url} 使用 ${result.provider} 补全文: ${result.originalContentLength} -> ${result.hydratedContentLength}`,
    );
  }
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}
