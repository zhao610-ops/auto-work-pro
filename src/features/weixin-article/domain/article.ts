import { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import { PublishResult } from "@src/core/ports/content-publisher.ts";
import { WeixinTemplate } from "@src/features/weixin-article/domain/renderable-article.ts";

export type RawArticle = ScrapedContent;

export interface RankedArticle extends RawArticle {
  score: number;
  reason?: string;
}

export type ProcessedArticle = WeixinTemplate;

export type RenderableArticle = WeixinTemplate;

export type PublishedArticle = PublishResult;
