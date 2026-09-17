import { Logger } from "@zilla/logger";
import { createLocalWeixinArticleWorkflowDefinition } from "@src/app/weixin-article/local-workflow.definition.ts";
import { createLocalArticleRuntimeStores } from "@src/app/weixin-article/local-runtime-stores.ts";
import { LocalWorkflowRuntime } from "@src/core/workflow/local-workflow-runtime.ts";
import type { ArtifactStore } from "@src/core/ports/artifact-store.ts";
import { ToutiaoRelayClient } from "@src/integrations/publish/providers/toutiao-relay-client.ts";
import {
  LocalToutiaoScheduleStore,
  type ToutiaoScheduleJob,
} from "@src/platform/local/local-toutiao-schedule-store.ts";
import type { ResolvedTrendPublishConfig } from "@src/utils/config/define-config.ts";
import { join } from "node:path";

const logger = new Logger("toutiao-scheduler");
const MIN_SCHEDULE_AHEAD_MS = 2 * 60 * 60 * 1000;
const SAFETY_MARGIN_MS = 5 * 60 * 1000;
let processing = false;

/** 每个 5 分钟心跳调用一次；头条任务独立于微信定时群发队列。 */
export async function processToutiaoSchedule(
  config: ResolvedTrendPublishConfig,
  now = new Date(),
): Promise<void> {
  if (!config.features.article.toutiao.enabled || processing) return;
  if (!config.providers.publish.toutiaoRelay.url ||
    !config.providers.publish.toutiaoRelay.token) {
    logger.error("[头条定时] 已启用但未配置 Relay URL 或 Token，跳过本次调度");
    return;
  }
  processing = true;
  try {
    const queue = createToutiaoScheduleStore(config);
    const client = new ToutiaoRelayClient(config.providers.publish.toutiaoRelay);
    await reconcileScheduledJobs(queue, client);

    const targetAt = nextBeijingDailyTime(now, config.features.article.toutiao.scheduleTime);
    const jobId = `toutiao-${targetAt.toISOString().replace(/[-:.TZ]/g, "").slice(0, 12)}`;
    const existing = await queue.get(jobId);
    if (existing?.status === "scheduled" || existing?.status === "published" ||
      existing?.status === "blocked") return;
    if (existing?.status === "failed" && existing.attempts >= 3) {
      await queue.save({
        ...existing,
        status: "blocked",
        error: "头条定时提交已连续失败 3 次，已停止自动重试",
      });
      return;
    }

    const latestSubmissionAt = targetAt.getTime() - MIN_SCHEDULE_AHEAD_MS -
      SAFETY_MARGIN_MS;
    if (now.getTime() > latestSubmissionAt) {
      if (!existing) {
        await queue.save({
          id: jobId,
          targetAt: targetAt.toISOString(),
          idempotencyKey: jobId,
          status: "blocked",
          attempts: 0,
          error: "已超过头条原生定时发布的最晚安全提交时间",
        });
      }
      return;
    }

    const preparationAt = targetAt.getTime() -
      config.features.article.toutiao.preparationLeadMinutes * 60_000;
    if (now.getTime() < preparationAt) return;

    const prepared = existing?.status === "ready" ||
        (existing?.status === "failed" && existing.title && existing.htmlArtifactKey)
      ? existing
      : await prepareToutiaoJob(config, queue, jobId, targetAt);
    await submitToutiaoJob(config, queue, client, prepared);
  } catch (error) {
    logger.error("[头条定时] 调度失败:", error);
  } finally {
    processing = false;
  }
}

export function createToutiaoScheduleStore(
  config: ResolvedTrendPublishConfig,
): LocalToutiaoScheduleStore {
  const outputDir = config.storage.artifacts.outputDir ||
    config.storage.runState.outputDir || "src/temp";
  return new LocalToutiaoScheduleStore(join(Deno.cwd(), outputDir));
}

async function prepareToutiaoJob(
  config: ResolvedTrendPublishConfig,
  queue: LocalToutiaoScheduleStore,
  jobId: string,
  targetAt: Date,
): Promise<ToutiaoScheduleJob> {
  await queue.save({
    id: jobId,
    targetAt: targetAt.toISOString(),
    idempotencyKey: jobId,
    status: "preparing",
    attempts: 0,
  });
  const runId = `toutiao-prepare-${jobId}`;
  const runtime = new LocalWorkflowRuntime();
  await runtime.run(createLocalWeixinArticleWorkflowDefinition(), {
    payload: {
      runId,
      trigger: "cron",
      dryRun: true,
      profileId: config.features.article.toutiao.profileId || undefined,
    },
    id: runId,
    timestamp: Date.now(),
  });

  const stores = createLocalArticleRuntimeStores(config);
  const title = await readJson<{ title: string }>(
    stores.artifactStore,
    stores.artifactStore.createRunKey(runId, "18-final-title", "json"),
  );
  const htmlArtifactKey = await resolveFinalHtmlKey(stores.artifactStore, runId);
  const cover = await readJson<{ imageUrl?: string }>(
    stores.artifactStore,
    stores.artifactStore.createRunKey(runId, "11-cover", "json"),
  );
  return await queue.save({
    id: jobId,
    targetAt: targetAt.toISOString(),
    sourceRunId: runId,
    title: title.title,
    htmlArtifactKey,
    coverImageUrl: cover.imageUrl,
    idempotencyKey: jobId,
    status: "ready",
    attempts: 0,
  });
}

async function submitToutiaoJob(
  config: ResolvedTrendPublishConfig,
  queue: LocalToutiaoScheduleStore,
  client: ToutiaoRelayClient,
  job: ToutiaoScheduleJob,
): Promise<void> {
  if (!job.title || !job.htmlArtifactKey) {
    throw new Error("头条定时任务缺少预生成标题或正文产物");
  }
  const stores = createLocalArticleRuntimeStores(config);
  const html = await readText(stores.artifactStore, job.htmlArtifactKey);
  try {
    const result = await client.schedule({
      title: job.title,
      contentHtml: html,
      coverImageUrl: job.coverImageUrl,
      idempotencyKey: job.idempotencyKey,
      scheduledAt: job.targetAt,
    });
    await queue.save({
      ...job,
      status: result.status === "scheduled" ? "scheduled" : "blocked",
      articleId: result.articleId,
      screenshotPath: result.screenshotPath,
      error: result.reason,
      attempts: job.attempts + 1,
    });
  } catch (error) {
    await queue.save({
      ...job,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      attempts: job.attempts + 1,
    });
    throw error;
  }
}

async function reconcileScheduledJobs(
  queue: LocalToutiaoScheduleStore,
  client: ToutiaoRelayClient,
): Promise<void> {
  for (const job of await queue.list()) {
    if (job.status !== "scheduled") continue;
    try {
      const remote = await client.reconcile(job.idempotencyKey);
      await queue.save({
        ...job,
        status: remote.status === "published" ? "published" : "scheduled",
        articleId: remote.articleId ?? job.articleId,
      });
    } catch (error) {
      logger.warn(`[头条定时] 状态反查失败，保留既有任务状态: ${
        error instanceof Error ? error.message : String(error)
      }`);
    }
  }
}

async function resolveFinalHtmlKey(
  artifacts: ArtifactStore,
  runId: string,
): Promise<string> {
  const revised = artifacts.createRunKey(runId, "19-final-article", "html");
  if (await artifacts.getObject(revised)) return revised;
  return artifacts.createRunKey(runId, "12-rendered-article", "html");
}

async function readJson<T>(artifacts: ArtifactStore, key: string): Promise<T> {
  const object = await artifacts.getObject(key);
  if (!object) throw new Error(`头条预生成产物不存在: ${key}`);
  return JSON.parse(new TextDecoder().decode(object.body)) as T;
}

async function readText(artifacts: ArtifactStore, key: string): Promise<string> {
  const object = await artifacts.getObject(key);
  if (!object) throw new Error(`头条预生成正文不存在: ${key}`);
  return new TextDecoder().decode(object.body);
}

/** 返回下一次北京时间日程，时区固定为 Asia/Shanghai（UTC+8）。 */
export function nextBeijingDailyTime(now: Date, time: string): Date {
  const [hour, minute] = time.split(":").map(Number);
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const candidate = new Date(Date.UTC(
    beijing.getUTCFullYear(),
    beijing.getUTCMonth(),
    beijing.getUTCDate(),
    hour - 8,
    minute,
  ));
  if (candidate.getTime() > now.getTime()) return candidate;
  candidate.setUTCDate(candidate.getUTCDate() + 1);
  return candidate;
}
