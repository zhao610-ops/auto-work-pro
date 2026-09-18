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
/** 心跳有运行漂移；超过该窗口则不补发过期日程，避免次日误发旧内容。 */
const DIRECT_PUBLISH_GRACE_MS = 15 * 60 * 1000;
let processing = false;

/** 每个 5 分钟心跳调用一次；提前生成，到系统目标时间才直接发布。 */
export async function processToutiaoSchedule(
  config: ResolvedTrendPublishConfig,
  now = new Date(),
): Promise<void> {
  // 兼容早期配置：未声明头条模块时，按关闭处理，不能影响公众号定时任务。
  if (!config.features.article.toutiao?.enabled || processing) return;
  if (
    !config.providers.publish.toutiaoRelay.url ||
    !config.providers.publish.toutiaoRelay.token
  ) {
    logger.error("[头条定时] 已启用但未配置 Relay URL 或 Token，跳过本次调度");
    return;
  }
  processing = true;
  try {
    const queue = createToutiaoScheduleStore(config);
    const client = new ToutiaoRelayClient(
      config.providers.publish.toutiaoRelay,
    );
    await reconcileScheduledJobs(queue, client);

    const targetAt = currentOrNextBeijingDailyTime(
      now,
      config.features.article.toutiao.scheduleTime,
    );
    const jobId = `toutiao-${
      targetAt.toISOString().replace(/[-:.TZ]/g, "").slice(0, 12)
    }`;
    const existing = await queue.get(jobId);
    if (
      existing?.status === "scheduled" || existing?.status === "published" ||
      existing?.status === "blocked"
    ) return;
    if (existing?.status === "failed" && existing.attempts >= 3) {
      await queue.save({
        ...existing,
        status: "blocked",
        error: "头条直接发布已连续失败 3 次，已停止自动重试",
      });
      return;
    }

    const preparationAt = targetAt.getTime() -
      config.features.article.toutiao.preparationLeadMinutes * 60_000;
    if (now.getTime() < preparationAt) return;

    const prepared = existing?.status === "ready" ||
        (existing?.status === "failed" && existing.title &&
          existing.htmlArtifactKey)
      ? existing
      : await prepareToutiaoJob(config, queue, jobId, targetAt);
    // 内容可提前准备，但浏览器的直接发布只能在系统目标时间到达后执行。
    if (now.getTime() < targetAt.getTime()) return;
    await publishToutiaoJob(config, queue, client, prepared);
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
  const htmlArtifactKey = await resolveFinalHtmlKey(
    stores.artifactStore,
    runId,
  );
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

async function publishToutiaoJob(
  config: ResolvedTrendPublishConfig,
  queue: LocalToutiaoScheduleStore,
  client: ToutiaoRelayClient,
  job: ToutiaoScheduleJob,
): Promise<void> {
  if (!job.title || !job.htmlArtifactKey) {
    throw new Error("头条直接发布任务缺少预生成标题或正文产物");
  }
  const stores = createLocalArticleRuntimeStores(config);
  const html = await readText(stores.artifactStore, job.htmlArtifactKey);
  try {
    const result = await client.publishNow({
      title: job.title,
      contentHtml: html,
      coverImageUrl: job.coverImageUrl,
      idempotencyKey: job.idempotencyKey,
    });
    await queue.save({
      ...job,
      status: result.status === "published" ? "published" : "blocked",
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
      logger.warn(
        `[头条定时] 状态反查失败，保留既有任务状态: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
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

async function readText(
  artifacts: ArtifactStore,
  key: string,
): Promise<string> {
  const object = await artifacts.getObject(key);
  if (!object) throw new Error(`头条预生成正文不存在: ${key}`);
  return new TextDecoder().decode(object.body);
}

/** 返回下一次北京时间日程，时区固定为 Asia/Shanghai（UTC+8）。 */
export function nextBeijingDailyTime(now: Date, time: string): Date {
  const candidate = beijingDailyTime(now, time);
  if (candidate.getTime() > now.getTime()) return candidate;
  candidate.setUTCDate(candidate.getUTCDate() + 1);
  return candidate;
}

/**
 * 允许目标时间后的短暂心跳窗口继续处理当天任务；超出窗口则选择下一天，
 * 防止服务恢复时意外补发几个小时前的内容。
 */
export function currentOrNextBeijingDailyTime(now: Date, time: string): Date {
  const candidate = beijingDailyTime(now, time);
  if (now.getTime() <= candidate.getTime() + DIRECT_PUBLISH_GRACE_MS) {
    return candidate;
  }
  candidate.setUTCDate(candidate.getUTCDate() + 1);
  return candidate;
}

function beijingDailyTime(now: Date, time: string): Date {
  const [hour, minute] = time.split(":").map(Number);
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return new Date(Date.UTC(
    beijing.getUTCFullYear(),
    beijing.getUTCMonth(),
    beijing.getUTCDate(),
    hour - 8,
    minute,
  ));
}
