import FirecrawlApp from "npm:firecrawl@1.19.0";
import {
  ContentScraper,
  ScrapedContent,
  ScraperOptions,
} from "@src/core/ports/content-scraper.ts";
import { formatDate } from "@src/utils/common.ts";
import zod from "npm:zod@3.25.76";
import { Logger } from "@zilla/logger";

const logger = new Logger("fireCrawl-scraper");

// 使用 zod 定义数据结构
const StorySchema = zod.object({
  headline: zod.string(),
  content: zod.string(),
  link: zod.string(),
  date_posted: zod.string(),
});

const StoriesSchema = zod.object({
  stories: zod.array(StorySchema),
});

type StoriesExtract = zod.infer<typeof StoriesSchema>;

const ArticleSchema = zod.object({
  article: zod.object({
    title: zod.string(),
    content: zod.string(),
    date_posted: zod.string().optional(),
  }),
});

type ArticleExtract = zod.infer<typeof ArticleSchema>;

interface FirecrawlScrapeResult {
  success?: boolean;
  error?: string;
  extract?: unknown;
}

interface FirecrawlScrapeClient {
  scrape?: (
    url: string,
    params: Record<string, unknown>,
  ) => Promise<FirecrawlScrapeResult>;
  scrapeUrl?: (
    url: string,
    params: Record<string, unknown>,
  ) => Promise<FirecrawlScrapeResult>;
}

export class FireCrawlScraper implements ContentScraper {
  private app!: FirecrawlApp;

  constructor(private readonly configuredApiKey?: string) {}

  async refresh(): Promise<void> {
    const startTime = Date.now();
    const apiKey = this.configuredApiKey;
    if (!apiKey) {
      throw new Error("providers.fetch.firecrawl.apiKey is not set");
    }
    this.app = new FirecrawlApp({
      apiKey,
    });
    logger.debug(`FireCrawlApp 初始化完成, 耗时: ${Date.now() - startTime}ms`);
  }

  private generateId(url: string): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    const urlHash = url.split("").reduce((acc, char) => {
      return ((acc << 5) - acc + char.charCodeAt(0)) | 0;
    }, 0);
    return `fc_${timestamp}_${random}_${Math.abs(urlHash)}`;
  }

  async scrape(
    sourceId: string,
    options?: ScraperOptions,
  ): Promise<ScrapedContent[]> {
    try {
      await this.refresh();
      const startTime = Date.now();
      const currentDate = new Date().toLocaleDateString();
      const scrape = this.getScrapeClient();

      if (isArticleDetailMode(options)) {
        return await this.scrapeArticleDetail(sourceId, scrape, startTime);
      }

      // 构建提取提示词
      const promptForFirecrawl = `
      Return only today's AI or LLM related story or post headlines and links in JSON format from the page content. 
      They must be posted today, ${currentDate}. The format should be:
        {
          "stories": [
            {
              "headline": "headline1",
              "content":"content1"
              "link": "link1",
              "date_posted": "YYYY-MM-DD HH:mm:ss",
            },
            ...
          ]
        }
      If there are no AI or LLM stories from today, return {"stories": []}.
      
      The source link is ${sourceId}. 
      If a story link is not absolute, prepend ${sourceId} to make it absolute. 
      Return only pure JSON in the specified format (no extra text, no markdown, no \\\\).  
      The content should be about 500 words, which can summarize the full text and the main point.
      Translate all into Chinese.
      !!
      `;

      // 使用 FirecrawlApp 进行抓取
      const scrapeResult = await scrape(sourceId, {
        formats: ["extract"],
        extract: {
          prompt: promptForFirecrawl,
          schema: StoriesSchema,
        },
      });

      if (scrapeResult.success === false || !scrapeResult.extract) {
        throw new Error(scrapeResult.error || "未获取到有效内容");
      }

      // 使用 zod 验证返回数据
      const validatedData = StoriesSchema.parse(scrapeResult.extract);

      // 转换为 ScrapedContent 格式
      logger.debug(
        `[FireCrawl] 从 ${sourceId} 获取到 ${validatedData.stories.length} 条内容 耗时: ${
          Date.now() - startTime
        }ms`,
      );
      return validatedData.stories.map((story) => ({
        id: this.generateId(story.link),
        title: story.headline,
        content: story.content,
        url: story.link,
        publishDate: formatDate(story.date_posted),
        score: 0,
        metadata: {
          source: "fireCrawl",
          originalUrl: story.link,
          datePosted: story.date_posted,
        },
      }));
    } catch (error) {
      const normalizedError = normalizeFirecrawlError(error);
      logger.error("FireCrawl抓取失败:", normalizedError);
      throw normalizedError;
    }
  }

  private async scrapeArticleDetail(
    sourceId: string,
    scrape: (
      url: string,
      params: Record<string, unknown>,
    ) => Promise<FirecrawlScrapeResult>,
    startTime: number,
  ): Promise<ScrapedContent[]> {
    const promptForArticleDetail = `
      Extract the main article from this exact URL, not a list of related stories.
      Return only pure JSON in this format:
      {
        "article": {
          "title": "article title",
          "content": "detailed article body",
          "date_posted": "YYYY-MM-DD HH:mm:ss"
        }
      }

      Rules:
      - Keep only facts present in the source page. Do not invent facts.
      - Preserve product names, dates, numbers, model names, quotes, and limitations.
      - Remove navigation, cookie banners, ads, recommendations, and footer text.
      - Translate the article body into Chinese, but keep key English product names.
      - If the source page has enough information, content should be detailed and useful for writing an analysis article, preferably 1200+ Chinese characters.
      - If the page has no readable article body, return an empty content string.
      The source URL is ${sourceId}.
    `;

    const scrapeResult = await scrape(sourceId, {
      formats: ["extract"],
      extract: {
        prompt: promptForArticleDetail,
        schema: ArticleSchema,
      },
    });

    if (scrapeResult.success === false || !scrapeResult.extract) {
      throw new Error(scrapeResult.error || "未获取到详情页内容");
    }

    const validatedData: ArticleExtract = ArticleSchema.parse(
      scrapeResult.extract,
    );
    const article = validatedData.article;
    const content = article.content.trim();
    if (!content) {
      throw new Error("详情页未提取到正文");
    }

    logger.debug(
      `[FireCrawl] 从 ${sourceId} 深抓正文 ${content.length} 字符 耗时: ${
        Date.now() - startTime
      }ms`,
    );

    return [{
      id: this.generateId(sourceId),
      title: article.title,
      content,
      url: sourceId,
      publishDate: article.date_posted
        ? formatDate(article.date_posted)
        : new Date().toISOString(),
      metadata: {
        source: "fireCrawl",
        originalUrl: sourceId,
        detail: true,
        datePosted: article.date_posted,
      },
    }];
  }

  private getScrapeClient(): (
    url: string,
    params: Record<string, unknown>,
  ) => Promise<FirecrawlScrapeResult> {
    const firecrawlClient = this.app as FirecrawlScrapeClient;
    const scrape = firecrawlClient.scrape?.bind(firecrawlClient) ??
      firecrawlClient.scrapeUrl?.bind(firecrawlClient);

    if (!scrape) {
      throw new Error("Firecrawl SDK 未提供 scrape 方法");
    }

    return scrape;
  }
}

function isArticleDetailMode(options?: ScraperOptions): boolean {
  return options?.filters?.mode === "article-detail";
}

function normalizeFirecrawlError(error: unknown): Error {
  if (error instanceof Error) {
    if (
      error instanceof TypeError &&
      error.message.includes("reading 'status'")
    ) {
      return new Error(
        "FireCrawl 请求失败：SDK 未返回响应状态，通常是网络中断、服务端限流或上游响应异常",
      );
    }
    return error;
  }
  return new Error(String(error));
}
