import { Media } from "@src/core/ports/content-scraper.ts";

export interface GeneratedArticleTemplate {
  id: string;
  title: string;
  content: string;
  url: string;
  publishDate: string;
  metadata: Record<string, unknown>;
}

export interface WeixinTemplate extends GeneratedArticleTemplate {
  keywords: string[];
  media?: Media[];
}

export interface ArticleImageLayoutService {
  setGeneratedImageEnabled?(enabled: boolean): void;
  layoutArticle(article: WeixinTemplate): Promise<WeixinTemplate>;
  layoutArticles(articles: WeixinTemplate[]): Promise<WeixinTemplate[]>;
}

export class NoopArticleImageLayoutService
  implements ArticleImageLayoutService {
  async layoutArticle(article: WeixinTemplate): Promise<WeixinTemplate> {
    return article;
  }

  async layoutArticles(articles: WeixinTemplate[]): Promise<WeixinTemplate[]> {
    return articles;
  }
}
