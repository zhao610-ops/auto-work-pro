import {
  WorkflowEvent,
  WorkflowStepContext,
  WorkflowStepOptions,
} from "@src/core/workflow/workflow-runtime.ts";
import { WorkflowTerminateError } from "@src/core/workflow/workflow-error.ts";
import { Logger } from "@zilla/logger";
import { WeixinArticleDependencies } from "@src/features/weixin-article/dependencies.ts";
import type { ArtifactRef } from "@src/core/ports/artifact-store.ts";
import { decodeJsonArtifact } from "@src/core/ports/artifact-store.ts";
import type { PublishResult } from "@src/core/ports/content-publisher.ts";
import type { RankResult } from "@src/core/ports/content-ranker.ts";
import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { ArticleSourceFilter } from "@src/features/weixin-article/services/content-scrape.service.ts";
import type { WeixinTemplate } from "@src/features/weixin-article/domain/renderable-article.ts";
import type { WeixinArticleSourceLoadResult } from "@src/features/weixin-article/services/content-scrape.service.ts";
import type { JsonObject } from "@src/core/ports/runtime-config-store.ts";
import type { CoverGenerationResult } from "@src/features/weixin-article/services/article-cover.service.ts";
import type { EditorialTopicReport } from "@src/features/weixin-article/domain/editorial-topic.ts";
import type { EditorialDecision } from "@src/features/weixin-article/domain/editorial-decision.ts";
import type { ArticlePlan } from "@src/features/weixin-article/domain/article-plan.ts";
import type { ArticleQualityReview } from "@src/features/weixin-article/domain/quality-review.ts";
import type { ArticleRevisionResult } from "@src/features/weixin-article/domain/article-revision.ts";
import type { EvidencePack } from "@src/features/weixin-article/domain/evidence.ts";
import type { EditorialMemoryContext } from "@src/core/ports/editorial-memory-store.ts";
import {
  evaluateArticleQualityGate,
  type QualityGateDecision,
} from "@src/features/weixin-article/services/quality-gate.service.ts";
import {
  alignArticleContentsForPlan,
} from "@src/features/weixin-article/services/article-content-alignment.service.ts";
import {
  createAccountLearningSnapshot,
} from "@src/features/weixin-article/services/account-learning-snapshot.ts";
import type { ResolvedTrendPublishConfig } from "@src/utils/config/define-config.ts";

const logger = new Logger("weixin-article-workflow");

interface WeixinWorkflowEnv {
  id: string;
  name: string;
}

interface WeixinWorkflowParams {
  sourceType?: ArticleSourceFilter;
  maxArticles?: number;
  forcePublish?: boolean;
  dryRun?: boolean;
  dryRunOutputDir?: string;
  runId?: string;
  trigger?: "manual" | "cron";
  profileId?: string;
  accountId?: string;
  runKind?: "single" | "matrix-parent" | "matrix-child";
  parentRunId?: string;
}

export interface WeixinArticleWorkflowConfig {
  dryRun: boolean;
  profileId?: string;
  accountId?: string;
  accountBrand?: JsonObject;
  runtimeConfigSnapshot?: JsonObject;
  qualityGate: ResolvedTrendPublishConfig["features"]["article"]["qualityGate"];
}

interface StepResult<T> {
  result: T;
  artifacts?: ArtifactRef[];
}

export class WeixinArticleWorkflow {
  constructor(
    private readonly env: WeixinWorkflowEnv,
    private readonly dependencies: WeixinArticleDependencies,
  ) {
  }

  async run(
    event: WorkflowEvent<WeixinWorkflowParams>,
    step: WorkflowStepContext,
  ): Promise<void> {
    const runId = event.payload.runId ?? event.id ?? crypto.randomUUID();
    const dryRun = await this.isDryRun(event);
    const artifactStore = this.dependencies.runtime.artifactStore;
    const runStateStore = this.dependencies.runtime.runStateStore;

    try {
      await runStateStore.startRun({
        runId,
        mode: this.dependencies.runtime.mode,
        runKind: event.payload.runKind ?? "single",
        parentRunId: event.payload.parentRunId,
        accountId: event.payload.accountId ??
          this.dependencies.config.accountId,
        profileId: event.payload.profileId ??
          this.dependencies.config.profileId,
        dryRun,
        trigger: event.payload.trigger ?? "manual",
      });

      logger.info(
        `[工作流开始] 开始执行微信工作流, 当前工作流实例ID: ${this.env.id} 触发事件ID: ${event.id}, runId: ${runId}`,
      );
      this.dependencies.renderService.setUploadContentImages(!dryRun);
      this.dependencies.renderService.setGenerateContentImages(!dryRun);

      if (this.dependencies.config.runtimeConfigSnapshot) {
        await this.runTrackedStep(
          step,
          runId,
          "runtime-config-snapshot",
          async () => {
            const ref = await artifactStore.putJson(
              artifactStore.createRunKey(runId, "00-runtime-config", "json"),
              this.dependencies.config.runtimeConfigSnapshot,
              { label: "运行时配置快照", contentType: "application/json" },
            );
            return { result: ref, artifacts: [ref] };
          },
        );
      }

      await this.runTrackedStep(step, runId, "validate-ip-whitelist", {
        retries: { limit: 3, delay: "10 second", backoff: "exponential" },
        timeout: "10 minutes",
      }, async () => {
        if (dryRun) {
          logger.info("[DryRun] 跳过微信公众号 IP 白名单验证");
          return { result: true };
        }
        const isWhitelisted = await this.dependencies.publisher
          .validateIpWhitelist();
        if (typeof isWhitelisted === "string") {
          this.dependencies.notifier.warning(
            "IP白名单验证失败",
            `当前服务器IP(${isWhitelisted})不在微信公众号IP白名单中，请在微信公众平台添加此IP地址`,
          );
          throw new WorkflowTerminateError(
            `当前服务器IP(${isWhitelisted})不在微信公众号IP白名单中，请在微信公众平台添加此IP地址`,
          );
        }
        return { result: isWhitelisted };
      });

      await this.dependencies.notifier.info(
        "工作流开始",
        "开始执行内容抓取和处理",
      );

      const sourceLoadRef = await this.runTrackedStep(
        step,
        runId,
        "fetch-sources",
        async () => {
          const result = await this.dependencies.scrapeService.loadSources(
            event.payload.sourceType,
          );
          const ref = await artifactStore.putJson(
            artifactStore.createRunKey(runId, "01-sources", "json"),
            result,
            { label: "数据源", contentType: "application/json" },
          );
          return { result: ref, artifacts: [ref] };
        },
      );
      const sourceLoadResult = await artifactStore
        .getJson<WeixinArticleSourceLoadResult>(sourceLoadRef);

      const allContentsRef = await this.runTrackedStep(
        step,
        runId,
        "scrape-contents",
        {
          retries: { limit: 3, delay: "10 second", backoff: "exponential" },
          timeout: "10 minutes",
        },
        async () => {
          const result = await this.dependencies.scrapeService
            .scrapeAllDetailed(
              sourceLoadResult,
            );
          const contentsRef = await artifactStore.putJson(
            artifactStore.createRunKey(runId, "02-scraped-contents", "json"),
            result.contents,
            { label: "抓取结果", contentType: "application/json" },
          );
          const healthRef = await artifactStore.putJson(
            artifactStore.createRunKey(runId, "02-source-health", "json"),
            result.health,
            { label: "数据源健康", contentType: "application/json" },
          );
          await this.dependencies.runtime.editorialMemoryStore
            .recordSourceHealth(runId, result.health)
            .catch((error) => {
              const message = error instanceof Error
                ? error.message
                : String(error);
              logger.warn(`[编辑记忆] 来源表现写入失败: ${message}`);
            });
          return { result: contentsRef, artifacts: [contentsRef, healthRef] };
        },
        [sourceLoadRef],
      );
      const allContentsForGuard = await artifactStore
        .getJson<ScrapedContent[]>(allContentsRef);
      if (allContentsForGuard.length === 0) {
        throw new WorkflowTerminateError("未获取到任何内容，流程终止");
      }

      const uniqueContentsRef = await this.runTrackedStep(
        step,
        runId,
        "dedup-contents",
        {
          retries: { limit: 2, delay: "5 second", backoff: "exponential" },
          timeout: "15 minutes",
        },
        async () => {
          const allContents = await artifactStore
            .getJson<ScrapedContent[]>(allContentsRef);
          const result = await this.dependencies.dedupService.deduplicate(
            allContents,
          );
          const ref = await artifactStore.putJson(
            artifactStore.createRunKey(runId, "03-unique-contents", "json"),
            result,
            { label: "去重后内容", contentType: "application/json" },
          );
          return { result: ref, artifacts: [ref] };
        },
        [allContentsRef],
      );

      const topicReportRef = await this.runTrackedStep(
        step,
        runId,
        "plan-editorial-topics",
        {
          retries: { limit: 1, delay: "2 second", backoff: "linear" },
          timeout: "8 minutes",
        },
        async () => {
          const uniqueContents = await artifactStore
            .getJson<ScrapedContent[]>(uniqueContentsRef);
          const memory = await this.dependencies.runtime.editorialMemoryStore
            .getContext({
              profileId: this.dependencies.config.profileId,
              accountId: this.dependencies.config.accountId,
              strictAccount: Boolean(this.dependencies.config.accountId),
              recentLimit: 10,
              sourceLimit: 25,
            });
          const strictAccount = Boolean(this.dependencies.config.accountId);
          const memoryRef = await artifactStore.putJson(
            artifactStore.createRunKey(runId, "04-editorial-memory", "json"),
            memory,
            { label: "编辑记忆", contentType: "application/json" },
          );
          const learningSnapshot = createAccountLearningSnapshot({
            memory,
            accountBrand: this.dependencies.config.accountBrand,
            accountId: this.dependencies.config.accountId,
            profileId: this.dependencies.config.profileId,
            strictAccount,
          });
          const learningRef = await artifactStore.putJson(
            artifactStore.createRunKey(
              runId,
              "04-account-learning",
              "json",
            ),
            learningSnapshot,
            { label: "账号学习快照", contentType: "application/json" },
          );
          const result = await this.dependencies.editorialTopicService
            .createTopicReport(uniqueContents, memory);
          const reportRef = await artifactStore.putJson(
            artifactStore.createRunKey(runId, "04-editorial-topics", "json"),
            result,
            { label: "今日选题", contentType: "application/json" },
          );
          const scoresRef = await artifactStore.putJson(
            artifactStore.createRunKey(runId, "05-topic-scores", "json"),
            result.scores,
            { label: "选题评分", contentType: "application/json" },
          );
          return {
            result: reportRef,
            artifacts: [memoryRef, learningRef, reportRef, scoresRef],
          };
        },
        [uniqueContentsRef],
      );
      const topicReport = await artifactStore.getJson<EditorialTopicReport>(
        topicReportRef,
      );

      const rankedContentsRef = await this.runTrackedStep(
        step,
        runId,
        "rank-contents",
        {
          retries: { limit: 2, delay: "5 second", backoff: "exponential" },
          timeout: "5 minutes",
        },
        async () => {
          const uniqueContents = await artifactStore
            .getJson<ScrapedContent[]>(uniqueContentsRef);
          logger.info(`[内容排序] 开始排序 ${uniqueContents.length} 条内容`);
          const ranked = await this.dependencies.contentRanker.rankContents(
            uniqueContents,
          );
          if (ranked.length === 0) {
            throw new WorkflowTerminateError(
              "内容排序失败，没有任何内容被评分",
            );
          }
          ranked.sort((a, b) => b.score - a.score);
          logger.info("[内容排序] 内容排序完成");
          const ref = await artifactStore.putJson(
            artifactStore.createRunKey(runId, "06-ranked-contents", "json"),
            ranked,
            { label: "排序结果", contentType: "application/json" },
          );
          return { result: ref, artifacts: [ref] };
        },
        [uniqueContentsRef],
      );

      const editorialDecisionRef = await this.runTrackedStep(
        step,
        runId,
        "decide-editorial-strategy",
        {
          retries: { limit: 1, delay: "2 second", backoff: "linear" },
          timeout: "8 minutes",
        },
        async () => {
          const uniqueContents = await artifactStore
            .getJson<ScrapedContent[]>(uniqueContentsRef);
          const memoryObject = await artifactStore.getObject(
            artifactStore.createRunKey(runId, "04-editorial-memory", "json"),
          );
          const memory = memoryObject
            ? decodeJsonArtifact<EditorialMemoryContext>(memoryObject.body)
            : undefined;
          const result = await this.dependencies.editorialDecisionService
            .createEditorialDecision(
              topicReport,
              uniqueContents,
              memory,
            );
          const ref = await artifactStore.putJson(
            artifactStore.createRunKey(
              runId,
              "08-editorial-decision",
              "json",
            ),
            result,
            { label: "编辑决策", contentType: "application/json" },
          );
          return { result: ref, artifacts: [ref] };
        },
        [topicReportRef, uniqueContentsRef],
      );
      const editorialDecision = await artifactStore.getJson<EditorialDecision>(
        editorialDecisionRef,
      );

      const processedContentsRef = await this.runTrackedStep(
        step,
        runId,
        "process-contents",
        {
          retries: { limit: 2, delay: "5 second", backoff: "exponential" },
          timeout: "15 minutes",
        },
        async () => {
          const rankedContents = await artifactStore
            .getJson<RankResult[]>(rankedContentsRef);
          const uniqueContents = await artifactStore
            .getJson<ScrapedContent[]>(uniqueContentsRef);
          const result = await this.dependencies.processService
            .processTopRanked(
              rankedContents,
              uniqueContents,
              event.payload.maxArticles,
              {
                topicReport,
                editorialDecision,
              },
            );
          const ref = await artifactStore.putJson(
            artifactStore.createRunKey(runId, "07-processed-contents", "json"),
            result,
            { label: "处理后文章", contentType: "application/json" },
          );
          return { result: ref, artifacts: [ref] };
        },
        [rankedContentsRef, uniqueContentsRef, editorialDecisionRef],
      );

      const evidencePackRef = await this.runTrackedStep(
        step,
        runId,
        "research-evidence",
        {
          retries: { limit: 1, delay: "2 second", backoff: "linear" },
          timeout: "10 minutes",
        },
        async () => {
          const processedContents = await artifactStore
            .getJson<ScrapedContent[]>(processedContentsRef);
          const result = await this.dependencies.researchService
            .createEvidencePack({
              topicReport,
              editorialDecision,
              contents: processedContents,
            });
          const ref = await artifactStore.putJson(
            artifactStore.createRunKey(runId, "08-evidence-pack", "json"),
            result,
            { label: "补充证据包", contentType: "application/json" },
          );
          return { result: ref, artifacts: [ref] };
        },
        [topicReportRef, editorialDecisionRef, processedContentsRef],
      );
      const evidencePack = await artifactStore.getJson<EvidencePack>(
        evidencePackRef,
      );

      const planInputContentsRef = await this.runTrackedStep(
        step,
        runId,
        "align-plan-contents",
        async () => {
          const processedContents = await artifactStore
            .getJson<ScrapedContent[]>(processedContentsRef);
          const result = alignArticleContentsForPlan({
            processedContents,
            evidencePack,
            editorialDecision,
          });
          const ref = await artifactStore.putJson(
            artifactStore.createRunKey(
              runId,
              "08-plan-input-contents",
              "json",
            ),
            result,
            { label: "计划输入内容", contentType: "application/json" },
          );
          return { result: ref, artifacts: [ref] };
        },
        [processedContentsRef, evidencePackRef, editorialDecisionRef],
      );

      const articlePlanRef = await this.runTrackedStep(
        step,
        runId,
        "plan-article",
        {
          retries: { limit: 1, delay: "2 second", backoff: "linear" },
          timeout: "8 minutes",
        },
        async () => {
          const planInputContents = await artifactStore
            .getJson<ScrapedContent[]>(planInputContentsRef);
          const result = await this.dependencies.articlePlanService
            .createArticlePlan(
              topicReport,
              planInputContents,
              editorialDecision,
              evidencePack,
            );
          const ref = await artifactStore.putJson(
            artifactStore.createRunKey(runId, "08-article-plan", "json"),
            result,
            { label: "文章计划", contentType: "application/json" },
          );
          return { result: ref, artifacts: [ref] };
        },
        [
          topicReportRef,
          planInputContentsRef,
          editorialDecisionRef,
          evidencePackRef,
        ],
      );
      const articlePlan = await artifactStore.getJson<ArticlePlan>(
        articlePlanRef,
      );

      const templateDataRef = await this.runTrackedStep(
        step,
        runId,
        "prepare-template-data",
        async () => {
          const planInputContents = await artifactStore
            .getJson<ScrapedContent[]>(planInputContentsRef);
          const result = this.dependencies.renderService.toTemplateData(
            planInputContents,
            articlePlan,
          );
          const ref = await artifactStore.putJson(
            artifactStore.createRunKey(runId, "09-template-data", "json"),
            result,
            { label: "模板数据", contentType: "application/json" },
          );
          return { result: ref, artifacts: [ref] };
        },
        [planInputContentsRef],
      );

      const draftedTemplateDataRef = await this.runTrackedStep(
        step,
        runId,
        "draft-article-content",
        {
          retries: { limit: 1, delay: "2 second", backoff: "linear" },
          timeout: "10 minutes",
        },
        async () => {
          const templateData = await artifactStore
            .getJson<WeixinTemplate[]>(templateDataRef);
          const result = await this.dependencies.articleDraftService
            .draftTemplateData(templateData, articlePlan);
          const ref = await artifactStore.putJson(
            artifactStore.createRunKey(
              runId,
              "10-drafted-template-data",
              "json",
            ),
            result,
            { label: "起草后模板数据", contentType: "application/json" },
          );
          return { result: ref, artifacts: [ref] };
        },
        [templateDataRef, articlePlanRef],
      );

      const titleRef = await this.runTrackedStep(
        step,
        runId,
        "generate-title",
        {
          retries: { limit: 1, delay: "2 second", backoff: "linear" },
          timeout: "10 minutes",
        },
        async () => {
          const planInputContents = await artifactStore
            .getJson<ScrapedContent[]>(planInputContentsRef);
          const result = await this.dependencies.titleService
            .generateSummaryTitle(planInputContents, {
              articlePlan,
              editorialDecision,
            });
          const ref = await artifactStore.putJson(
            artifactStore.createRunKey(runId, "10-title", "json"),
            { title: result },
            { label: "标题", contentType: "application/json" },
          );
          return { result: ref, artifacts: [ref] };
        },
        [planInputContentsRef],
      );
      const summaryTitle = (await artifactStore.getJson<{ title: string }>(
        titleRef,
      )).title;

      const coverRef = await this.runTrackedStep(
        step,
        runId,
        "generate-cover",
        {
          retries: { limit: 2, delay: "5 second", backoff: "exponential" },
          timeout: "5 minutes",
        },
        async () => {
          const result: CoverGenerationResult = dryRun
            ? {
              mediaId: "dry-run-media-id",
              generated: false,
              fallback: false,
              generatorType: "dry-run",
            }
            : await this.dependencies.coverService.generateCover(
              summaryTitle,
            );
          const ref = await artifactStore.putJson(
            artifactStore.createRunKey(runId, "11-cover", "json"),
            result,
            { label: "封面", contentType: "application/json" },
          );
          return { result: ref, artifacts: [ref] };
        },
        [titleRef],
      );
      const coverResult = await artifactStore.getJson<CoverGenerationResult>(
        coverRef,
      );
      const mediaId = coverResult.mediaId;

      const renderedTemplateRef = await this.runTrackedStep(
        step,
        runId,
        "render-article-template",
        {
          retries: { limit: 0, delay: "2 second", backoff: "linear" },
          timeout: "12 minutes",
        },
        async () => {
          const templateData = await artifactStore
            .getJson<WeixinTemplate[]>(draftedTemplateDataRef);
          const html = await this.dependencies.renderService.render(
            templateData,
            { articlePlan },
          );
          const ref = await artifactStore.putText(
            artifactStore.createRunKey(runId, "12-rendered-article", "html"),
            html,
            {
              label: "微信正文 HTML",
              contentType: "text/html; charset=utf-8",
            },
          );
          return { result: ref, artifacts: [ref] };
        },
        [draftedTemplateDataRef],
      );

      const qualityReviewRef = await this.runTrackedStep(
        step,
        runId,
        "review-article-quality",
        {
          retries: { limit: 1, delay: "2 second", backoff: "linear" },
          timeout: "8 minutes",
        },
        async () => {
          const renderedTemplate = await artifactStore.getText(
            renderedTemplateRef,
          );
          const planInputContents = await artifactStore
            .getJson<ScrapedContent[]>(planInputContentsRef);
          const result = await this.dependencies.qualityReviewService
            .reviewArticle({
              title: summaryTitle,
              html: renderedTemplate,
              articlePlan,
              topicReport,
              contents: planInputContents,
              evidencePack,
            });
          const ref = await artifactStore.putJson(
            artifactStore.createRunKey(runId, "13-quality-review", "json"),
            result,
            { label: "质量审稿", contentType: "application/json" },
          );
          return { result: ref, artifacts: [ref] };
        },
        [
          renderedTemplateRef,
          titleRef,
          articlePlanRef,
          topicReportRef,
          planInputContentsRef,
          evidencePackRef,
        ],
      );
      const qualityReview = await artifactStore.getJson<ArticleQualityReview>(
        qualityReviewRef,
      );

      let finalTitle = summaryTitle;
      let finalHtmlRef = renderedTemplateRef;
      let finalReview = qualityReview;
      let finalReviewRef = qualityReviewRef;
      let revisionSummary = "未修复";

      const maxRevisionRounds = Math.max(
        0,
        Math.min(2, this.dependencies.config.qualityGate.maxRevisionRounds),
      );
      if (maxRevisionRounds > 0) {
        const planInputContents = await artifactStore
          .getJson<ScrapedContent[]>(planInputContentsRef);
        for (let round = 1; round <= maxRevisionRounds; round++) {
          if (!shouldReviseArticle(finalReview)) break;
          const previousTitle = finalTitle;
          const previousHtmlRef = finalHtmlRef;
          const previousReview = finalReview;
          const previousReviewRef = finalReviewRef;
          const revisionRef = await this.runTrackedStep(
            step,
            runId,
            `revise-article-round-${round}`,
            {
              retries: { limit: 1, delay: "2 second", backoff: "linear" },
              timeout: "8 minutes",
            },
            async () => {
              const currentHtml = await artifactStore.getText(finalHtmlRef);
              const result = await this.dependencies.revisionService
                .reviseArticle({
                  round,
                  title: finalTitle,
                  html: currentHtml,
                  articlePlan,
                  qualityReview: finalReview,
                  contents: planInputContents,
                });
              const ref = await artifactStore.putJson(
                artifactStore.createRunKey(
                  runId,
                  `15-revision-round-${round}`,
                  "json",
                ),
                result,
                { label: `文章修复 ${round}`, contentType: "application/json" },
              );
              return { result: ref, artifacts: [ref] };
            },
            [finalHtmlRef, finalReviewRef, articlePlanRef],
          );
          const revision = await artifactStore.getJson<ArticleRevisionResult>(
            revisionRef,
          );
          if (!revision.applied) {
            revisionSummary = `第 ${round} 轮未应用`;
            break;
          }

          const candidateTitle = revision.title;
          const candidateHtmlRef = await artifactStore.putText(
            artifactStore.createRunKey(
              runId,
              `16-revised-article-round-${round}`,
              "html",
            ),
            revision.html,
            {
              label: `修复后 HTML ${round}`,
              contentType: "text/html; charset=utf-8",
            },
          );
          const candidateReviewRef = await this.runTrackedStep(
            step,
            runId,
            `review-revised-article-round-${round}`,
            {
              retries: { limit: 1, delay: "2 second", backoff: "linear" },
              timeout: "8 minutes",
            },
            async () => {
              const result = await this.dependencies.qualityReviewService
                .reviewArticle({
                  title: candidateTitle,
                  html: revision.html,
                  articlePlan,
                  topicReport,
                  contents: planInputContents,
                  evidencePack,
                });
              const ref = await artifactStore.putJson(
                artifactStore.createRunKey(
                  runId,
                  `17-quality-review-round-${round + 1}`,
                  "json",
                ),
                result,
                {
                  label: `质量复审 ${round + 1}`,
                  contentType: "application/json",
                },
              );
              return { result: ref, artifacts: [ref] };
            },
            [
              candidateHtmlRef,
              revisionRef,
              articlePlanRef,
              planInputContentsRef,
              evidencePackRef,
            ],
          );
          const candidateReview = await artifactStore
            .getJson<ArticleQualityReview>(
              candidateReviewRef,
            );

          if (!shouldAcceptArticleRevision(previousReview, candidateReview)) {
            finalTitle = previousTitle;
            finalHtmlRef = previousHtmlRef;
            finalReview = previousReview;
            finalReviewRef = previousReviewRef;
            revisionSummary = `第 ${round} 轮修复未采纳: ${
              formatQualityReviewSummary(previousReview)
            } -> ${formatQualityReviewSummary(candidateReview)}`;
            logger.warn(`[文章修复] ${revisionSummary}`);
            break;
          }

          finalTitle = candidateTitle;
          finalHtmlRef = candidateHtmlRef;
          finalReviewRef = candidateReviewRef;
          finalReview = candidateReview;
          revisionSummary = `第 ${round} 轮修复: ${
            revision.changedFields.join(", ")
          }`;
        }
      }

      const finalTitleRef = await artifactStore.putJson(
        artifactStore.createRunKey(runId, "18-final-title", "json"),
        { title: finalTitle },
        { label: "最终标题", contentType: "application/json" },
      );
      const finalHtmlSnapshotRef = finalHtmlRef === renderedTemplateRef
        ? renderedTemplateRef
        : await artifactStore.putText(
          artifactStore.createRunKey(runId, "19-final-article", "html"),
          await artifactStore.getText(finalHtmlRef),
          {
            label: "最终微信正文 HTML",
            contentType: "text/html; charset=utf-8",
          },
        );

      const publishRef = await this.runTrackedStep(
        step,
        runId,
        "publish-article",
        {
          retries: { limit: 3, delay: "10 second", backoff: "exponential" },
          timeout: "5 minutes",
        },
        async () => {
          const publishResultKey = artifactStore.createRunKey(
            runId,
            "14-publish-result",
            "json",
          );
          const existingPublishResult = await artifactStore.getObject(
            publishResultKey,
          );
          if (existingPublishResult) {
            const ref: ArtifactRef = {
              ...existingPublishResult.ref,
              label: existingPublishResult.ref.label ?? "发布结果",
            };
            return { result: ref, artifacts: [ref] };
          }

          const renderedTemplate = await artifactStore.getText(
            finalHtmlSnapshotRef,
          );
          const dryRunPreviewRef = dryRun
            ? await this.dependencies.dryRunOutputService.writeHtml(
              runId,
              renderedTemplate,
            )
            : undefined;
          const qualityGateDecision = evaluateArticleQualityGate({
            review: finalReview,
            config: this.dependencies.config.qualityGate,
            dryRun,
            forcePublish: event.payload.forcePublish,
          });
          if (qualityGateDecision.bypassed) {
            logger.warn(`[发布保护] ${qualityGateDecision.reason}`);
          }
          const blockedPublishResult = !qualityGateDecision.allowed
            ? createBlockedPublishResult(qualityGateDecision)
            : undefined;
          const publishResult = dryRun
            ? {
              publishId: "dry-run",
              status: "draft" as const,
              publishedAt: new Date(),
              platform: "weixin",
              url: dryRunPreviewRef?.key,
            }
            : blockedPublishResult
            ? blockedPublishResult
            : await this.publishArticle(
              renderedTemplate,
              finalTitle,
              mediaId,
            );
          const ref = await artifactStore.putJson(
            publishResultKey,
            publishResult,
            { label: "发布结果", contentType: "application/json" },
          );
          return {
            result: ref,
            artifacts: [dryRunPreviewRef, ref].filter(Boolean) as ArtifactRef[],
          };
        },
        [finalHtmlSnapshotRef, finalTitleRef, coverRef, finalReviewRef],
      );
      const publishResult = await artifactStore.getJson<PublishResult>(
        publishRef,
      );
      await this.dependencies.runtime.editorialMemoryStore.recordArticle({
        runId,
        profileId: this.dependencies.config.profileId,
        accountId: this.dependencies.config.accountId,
        title: finalTitle,
        thesis: articlePlan.thesis,
        keywords: extractTopicKeywords(topicReport),
        topicTitles: topicReport.clusters.map((cluster) => cluster.title),
        sourceUrls: extractSourceUrls(
          await artifactStore.getJson<ScrapedContent[]>(processedContentsRef),
        ),
        qualityScore: finalReview.overallScore,
        publishStatus: publishResult.status,
        dryRun,
      }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`[编辑记忆] 文章记忆写入失败: ${message}`);
      });

      const summary = `
        工作流执行完成
        - 账号: ${this.dependencies.config.accountId || "default"}
        - 数据源: ${sourceLoadResult.totalSources} 个
        - 成功: ${this.dependencies.stats.success} 个
        - 失败: ${this.dependencies.stats.failed} 个
        - 内容: ${this.dependencies.stats.contents} 条
        - 重复: ${this.dependencies.stats.duplicates} 条
        - 选题: ${formatTopicSummary(topicReport)}
        - 编辑决策: ${formatEditorialDecisionSummary(editorialDecision)}
        - 文章计划: ${formatArticlePlanSummary(articlePlan)}
        - 修复: ${revisionSummary}
        - 质量审稿: ${formatQualityReviewSummary(finalReview)}
        - 封面: ${formatCoverSummary(coverResult)}
        - 发布: ${formatPublishSummary(publishResult, dryRun)}`.trim();

      await runStateStore.finishRun(runId, {
        summary,
        artifacts: (await runStateStore.getRun(runId))?.artifacts ??
          [publishRef],
      });

      logger.info(`[工作流完成] ${summary}`);

      if (publishResult.status === "blocked") {
        await this.dependencies.notifier.warning("发布被质量门禁拦截", summary);
      } else if (this.dependencies.stats.failed > 0) {
        await this.dependencies.notifier.warning(
          "工作流完成(部分失败)",
          summary,
        );
      } else {
        await this.dependencies.notifier.success("工作流完成", summary);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await runStateStore.failRun(runId, message).catch(() => {});

      if (error instanceof WorkflowTerminateError) {
        await this.dependencies.notifier.warning("工作流终止", message);
        throw error;
      }

      logger.error("[工作流] 执行失败:", message);
      await this.dependencies.notifier.error("工作流失败", message);
      throw error;
    }
  }

  private async runTrackedStep<T>(
    step: WorkflowStepContext,
    runId: string,
    name: string,
    optionsOrFn:
      | WorkflowStepOptions
      | (() => Promise<StepResult<T>>),
    fnOrInputArtifacts?:
      | (() => Promise<StepResult<T>>)
      | ArtifactRef[],
    maybeInputArtifacts: ArtifactRef[] = [],
  ): Promise<T> {
    const options = typeof optionsOrFn === "function" ? undefined : optionsOrFn;
    const fn = typeof optionsOrFn === "function"
      ? optionsOrFn
      : fnOrInputArtifacts as () => Promise<StepResult<T>>;
    const inputArtifacts = Array.isArray(fnOrInputArtifacts)
      ? fnOrInputArtifacts
      : maybeInputArtifacts;

    const executor = async () => {
      await this.dependencies.runtime.runStateStore.startStep(runId, name, {
        inputArtifacts,
      });
      try {
        const stepResult = await fn();
        await this.dependencies.runtime.runStateStore.finishStep(runId, name, {
          outputArtifacts: stepResult.artifacts ?? [],
        });
        return stepResult.result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.dependencies.runtime.runStateStore.failStep(
          runId,
          name,
          message,
        ).catch(() => {});
        throw error;
      }
    };

    if (options) {
      return await step.do(name, options, executor);
    }
    return await step.do(name, executor);
  }

  private async publishArticle(
    renderedTemplate: string,
    summaryTitle: string,
    mediaId: string,
  ): Promise<PublishResult> {
    logger.info("[发布] 发布到微信公众号");
    return await this.dependencies.publisher.publishArticle({
      content: renderedTemplate,
      title: summaryTitle,
      digest: summaryTitle,
      coverMediaId: mediaId,
    });
  }

  private async isDryRun(
    event: WorkflowEvent<WeixinWorkflowParams>,
  ): Promise<boolean> {
    if (event.payload.forcePublish) {
      return false;
    }
    if (event.payload.dryRun) {
      return true;
    }
    return this.dependencies.config.dryRun;
  }
}

function formatCoverSummary(result: CoverGenerationResult): string {
  if (result.generatorType === "dry-run") {
    return "DryRun 跳过生成";
  }
  if (result.generated) {
    return `已生成${result.model ? ` (${result.model})` : ""}`;
  }
  if (result.fallback) {
    return `使用默认封面${result.error ? `，原因: ${result.error}` : ""}`;
  }
  return "未生成";
}

function formatTopicSummary(report: EditorialTopicReport): string {
  const leadCount =
    report.scores.filter((score) => score.recommendedUse === "lead").length;
  const fallback = report.fallback ? "，兜底" : "";
  return `${report.clusters.length} 个主题，${leadCount} 个主线候选${fallback}`;
}

function formatArticlePlanSummary(plan: ArticlePlan): string {
  const fallback = plan.fallback ? "，兜底" : "";
  return `${plan.format}，${plan.sections.length} 个章节${fallback}`;
}

function formatEditorialDecisionSummary(decision: EditorialDecision): string {
  const fallback = decision.fallback ? "，兜底" : "";
  return `${decision.leadTopicTitle}，${decision.recommendedFormat}${fallback}`;
}

function extractTopicKeywords(report: EditorialTopicReport): string[] {
  const seen = new Set<string>();
  for (const cluster of report.clusters) {
    for (const keyword of cluster.keywords) {
      const trimmed = keyword.trim();
      if (trimmed) seen.add(trimmed);
    }
  }
  return [...seen].slice(0, 20);
}

function extractSourceUrls(contents: ScrapedContent[]): string[] {
  const seen = new Set<string>();
  for (const content of contents) {
    if (content.url) seen.add(content.url);
  }
  return [...seen].slice(0, 50);
}

function formatQualityReviewSummary(review: ArticleQualityReview): string {
  const fallback = review.fallback ? "，兜底" : "";
  return `${review.overallScore} 分，${review.recommendedAction}${fallback}`;
}

export function shouldReviseArticle(review: ArticleQualityReview): boolean {
  if (review.recommendedAction === "publish" && review.overallScore >= 80) {
    return false;
  }
  return review.issues.some(isSafeRevisionCandidate);
}

export function shouldAcceptArticleRevision(
  before: ArticleQualityReview,
  after: ArticleQualityReview,
): boolean {
  const beforeHasBlocker = hasBlockerIssue(before);
  const afterHasBlocker = hasBlockerIssue(after);
  if (afterHasBlocker && !beforeHasBlocker) return false;
  if (before.allowPublish && !after.allowPublish) return false;

  const beforeRank = qualityActionRank(before.recommendedAction);
  const afterRank = qualityActionRank(after.recommendedAction);
  if (afterRank > beforeRank) return true;
  if (afterRank < beforeRank) return false;
  return after.overallScore >= before.overallScore;
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

function hasBlockerIssue(review: ArticleQualityReview): boolean {
  return review.issues.some((issue) => issue.severity === "blocker") ||
    review.recommendedAction === "block";
}

function qualityActionRank(
  action: ArticleQualityReview["recommendedAction"],
): number {
  switch (action) {
    case "block":
      return 0;
    case "revise":
      return 1;
    case "dry-run-only":
      return 2;
    case "publish":
      return 3;
  }
}

function createBlockedPublishResult(
  decision: QualityGateDecision,
): PublishResult {
  return {
    publishId: "blocked",
    status: "blocked",
    publishedAt: new Date(),
    platform: "weixin",
    reason: decision.reason,
  };
}

function formatPublishSummary(result: PublishResult, dryRun: boolean): string {
  if (dryRun) return "DryRun(未发布)";
  if (result.status === "blocked") {
    return `被质量门禁拦截${result.reason ? `: ${result.reason}` : ""}`;
  }
  return "成功";
}
