import { ContentRanker } from "@src/modules/content-rank/ai.content-ranker.ts";
import { INotifier } from "@src/core/ports/notifier.ts";
import {
  ContentImageUploader,
  ContentPublisher,
} from "@src/core/ports/content-publisher.ts";
import { WeixinArticleContentDedupService } from "@src/features/weixin-article/services/content-dedup.service.ts";
import { WeixinArticleContentProcessService } from "@src/features/weixin-article/services/content-process.service.ts";
import { WeixinArticleContentScrapeService } from "@src/features/weixin-article/services/content-scrape.service.ts";
import { WeixinArticleCoverService } from "@src/features/weixin-article/services/article-cover.service.ts";
import { WeixinArticleDryRunOutputService } from "@src/features/weixin-article/services/dry-run-output.service.ts";
import { WeixinArticleRenderService } from "@src/features/weixin-article/services/article-render.service.ts";
import { WeixinArticleTitleService } from "@src/features/weixin-article/services/article-title.service.ts";
import { WeixinArticleWorkflowStats } from "@src/features/weixin-article/services/workflow-stats.ts";
import { WeixinArticleEditorialTopicService } from "@src/features/weixin-article/services/editorial-topic.service.ts";
import { WeixinArticleEditorialDecisionService } from "@src/features/weixin-article/services/editorial-decision.service.ts";
import { WeixinArticlePlanService } from "@src/features/weixin-article/services/article-plan.service.ts";
import { WeixinArticleDraftService } from "@src/features/weixin-article/services/article-draft.service.ts";
import { WeixinArticleQualityReviewService } from "@src/features/weixin-article/services/quality-review.service.ts";
import { WeixinArticleRevisionService } from "@src/features/weixin-article/services/article-revision.service.ts";
import { WeixinArticleResearchService } from "@src/features/weixin-article/services/article-research.service.ts";
import type { WeixinArticleWorkflowConfig } from "@src/features/weixin-article/workflow.ts";
import type { ArtifactStore } from "@src/core/ports/artifact-store.ts";
import type {
  RunStateStore,
  RuntimeMode,
} from "@src/core/ports/run-state-store.ts";
import type { EditorialMemoryStore } from "@src/core/ports/editorial-memory-store.ts";

export interface WeixinArticlePublisher
  extends ContentPublisher, ContentImageUploader {
  validateIpWhitelist(): Promise<string | boolean>;
}

export interface WeixinArticleRuntimeDependencies {
  artifactStore: ArtifactStore;
  runStateStore: RunStateStore;
  editorialMemoryStore: EditorialMemoryStore;
  mode: RuntimeMode;
}

export interface WeixinArticleDependencies {
  publisher: WeixinArticlePublisher;
  notifier: INotifier;
  scrapeService: WeixinArticleContentScrapeService;
  dedupService: WeixinArticleContentDedupService;
  processService: WeixinArticleContentProcessService;
  titleService: WeixinArticleTitleService;
  coverService: WeixinArticleCoverService;
  renderService: WeixinArticleRenderService;
  dryRunOutputService: WeixinArticleDryRunOutputService;
  contentRanker: ContentRanker;
  editorialTopicService: WeixinArticleEditorialTopicService;
  editorialDecisionService: WeixinArticleEditorialDecisionService;
  articlePlanService: WeixinArticlePlanService;
  articleDraftService: WeixinArticleDraftService;
  researchService: WeixinArticleResearchService;
  qualityReviewService: WeixinArticleQualityReviewService;
  revisionService: WeixinArticleRevisionService;
  stats: WeixinArticleWorkflowStats;
  runtime: WeixinArticleRuntimeDependencies;
  config: WeixinArticleWorkflowConfig;
}
