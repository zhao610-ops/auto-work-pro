import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { RankResult } from "@src/core/ports/content-ranker.ts";
import type { ArticleQualityReview } from "@src/features/weixin-article/domain/quality-review.ts";
import type { ArticlePlan } from "@src/features/weixin-article/domain/article-plan.ts";
import type { ArticleRevisionResult } from "@src/features/weixin-article/domain/article-revision.ts";
import type { EditorialDecision } from "@src/features/weixin-article/domain/editorial-decision.ts";
import type { EditorialTopicReport } from "@src/features/weixin-article/domain/editorial-topic.ts";
import type {
  ArticleSourceHealthReport,
  WeixinArticleSourceLoadResult,
} from "@src/features/weixin-article/services/content-scrape.service.ts";

export type EvidenceSourceType =
  | "official"
  | "primary"
  | "media"
  | "community"
  | "background";

export interface EvidenceItem {
  id: string;
  title: string;
  url: string;
  provider: string;
  sourceType: EvidenceSourceType;
  summary: string;
  supports: string[];
  confidence: "high" | "medium" | "low";
}

export interface EvidencePack {
  topic: string;
  generatedAt: string;
  queries: string[];
  items: EvidenceItem[];
  gaps: string[];
}

export interface ArticleQualityExperimentOptions {
  experimentId: string;
  outputDir: string;
  profileId?: string;
  sourceType?: string;
  maxArticles?: number;
  maxResearchQueries: number;
  maxResultsPerQuery: number;
  maxRevisionRounds: number;
  hypothesis: string;
}

export interface ArticleQualityExperimentSnapshot {
  experimentId: string;
  generatedAt: string;
  profileId?: string;
  config: {
    article: {
      count: number;
      renderer: unknown;
      sourceLimits: unknown;
      qualityGate: unknown;
      sources: string[];
    };
    fetchGroups: Record<string, unknown>;
    providers: Record<string, boolean>;
  };
  sources: WeixinArticleSourceLoadResult;
  sourceHealth: ArticleSourceHealthReport;
  counts: {
    scraped: number;
    unique: number;
    ranked: number;
    processed: number;
  };
  rankedTop: RankResult[];
  topicReport: EditorialTopicReport;
  editorialDecision: EditorialDecision;
  processedContents: Array<
    Pick<
      ScrapedContent,
      "id" | "title" | "url" | "publishDate"
    > & { excerpt: string }
  >;
}

export interface ArticleQualityExperimentBranch {
  name: "baseline" | "variant";
  title: string;
  html: string;
  articlePlan: ArticlePlan;
  review: ArticleQualityReview;
  revision?: ArticleRevisionResult;
  contents: ScrapedContent[];
}

export interface QualityComparison {
  generatedAt: string;
  validForDecision: boolean;
  diagnostics: string[];
  baseline: {
    title: string;
    score: number;
    action: string;
    issueCount: number;
    revisionApplied: boolean;
    review: ArticleQualityReview;
  };
  variant: {
    title: string;
    score: number;
    action: string;
    issueCount: number;
    revisionApplied: boolean;
    review: ArticleQualityReview;
  };
  delta: {
    score: number;
    issueCount: number;
  };
  winner: "baseline" | "variant" | "tie";
  summary: string;
}
