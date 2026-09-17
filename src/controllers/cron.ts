import cron from "npm:node-cron@3.0.3";
import { Logger } from "@zilla/logger";
import { LocalWorkflowRuntime } from "@src/core/workflow/local-workflow-runtime.ts";
import {
  createArticlePublisher,
} from "@src/app/weixin-article/create-weixin-article-dependencies.ts";
import {
  createLocalWeixinArticleWorkflowDefinition,
} from "@src/app/weixin-article/local-workflow.definition.ts";
import { getAppConfig } from "@src/utils/config/app-config.ts";
import { createArticleNotifier } from "@src/app/weixin-article/notifications.ts";
import { createLocalArticleRuntimeStores } from "@src/app/weixin-article/local-runtime-stores.ts";
import {
  resolveArticleRuntimeConfig,
  seedArticleRuntimeConfig,
} from "@src/app/weixin-article/runtime/article-runtime-config.service.ts";
import type { PublishResult } from "@src/core/ports/content-publisher.ts";
import { LocalScheduledMassSendStore } from "@src/platform/local/local-scheduled-mass-send-store.ts";
import { join } from "node:path";
import { processToutiaoSchedule } from "@src/controllers/toutiao-scheduler.ts";
const logger = new Logger("cron");
const PREPARE_LEAD_MS = 10 * 60 * 1000;
export enum WorkflowType {
  WeixinArticle = "weixin-article-workflow",
}

export function getWorkflow(type: WorkflowType) {
  if (type !== WorkflowType.WeixinArticle) {
    throw new Error(`未知的工作流类型: ${type}`);
  }
  return createLocalWeixinArticleWorkflowDefinition();
}

export const startCronJobs = async () => {
  const config = await getAppConfig();
  const notifier = createArticleNotifier(config);
  notifier.notify("定时任务启动", "定时任务启动");
  logger.info("初始化定时任务...");

  // Heartbeat 调度：具体业务时间由 Dashboard runtime config 控制。
  cron.schedule(
    "*/5 * * * *",
    async () => {
      try {
        logger.info("检查到期微信文章工作流...");
        const runtimeStores = createLocalArticleRuntimeStores(config);
        await seedArticleRuntimeConfig(
          runtimeStores.runtimeConfigStore,
          config,
        );
        const now = new Date();
        await prepareUpcomingMassSends(config, runtimeStores, now);
        await dispatchDueMassSends(config, runtimeStores, now);
        await processToutiaoSchedule(config, now);
      } catch (error) {
        logger.error(`工作流执行失败:`, error);
        notifier.notify("工作流执行失败", String(error));
      }
    },
    {
      timezone: "Asia/Shanghai",
    },
  );
};

type LocalRuntimeStores = ReturnType<typeof createLocalArticleRuntimeStores>;

export async function prepareUpcomingMassSends(
  config: Awaited<ReturnType<typeof getAppConfig>>,
  runtimeStores: LocalRuntimeStores,
  now: Date,
): Promise<void> {
  const preparationTarget = new Date(now.getTime() + PREPARE_LEAD_MS);
  const dueSchedules = await runtimeStores.runtimeConfigStore
    .listDueSchedules(preparationTarget);
  const queue = createScheduledStore(config);

  for (const due of dueSchedules) {
    const preparationTickId = `${due.schedule.id}:prepare`;
    if (
      !await runtimeStores.runtimeConfigStore.markScheduleTriggered(
        preparationTickId,
        due.slot,
      )
    ) continue;

    const runId = `cron-prepare-${crypto.randomUUID()}`;
    try {
      const runtime = new LocalWorkflowRuntime();
      await runtime.run(createLocalWeixinArticleWorkflowDefinition(), {
        payload: {
          runId,
          trigger: "cron",
          dryRun: due.schedule.dryRun,
          profileId: due.schedule.profileId,
          prepareOnly: true,
          scheduledSendAt: preparationTarget.toISOString(),
        },
        id: runId,
        timestamp: now.getTime(),
      });

      const publishResult = await readRunJson<PublishResult>(
        runtimeStores,
        runId,
        "14-publish-result",
      );
      const title = await readRunJson<{ title: string }>(
        runtimeStores,
        runId,
        "18-final-title",
      );
      if (
        publishResult.status !== "scheduled" ||
        !publishResult.draftMediaId
      ) {
        logger.warn(
          `[定时群发] 草稿未进入待发送队列: ${
            publishResult.reason ?? publishResult.status
          }`,
        );
        continue;
      }
      await queue.save({
        scheduleId: due.schedule.id,
        scheduleSlot: due.slot,
        profileId: due.schedule.profileId,
        accountId: publishResult.accountId,
        sourceRunId: runId,
        draftMediaId: publishResult.draftMediaId,
        title: title.title,
        scheduledFor: preparationTarget.toISOString(),
        idempotencyKey: `scheduled-${runId}`.slice(0, 32),
        status: "prepared",
      });
      logger.info(
        `[定时群发] 草稿准备完成，将在 ${preparationTarget.toISOString()} 群发: ${title.title}`,
      );
    } catch (error) {
      logger.error("[定时群发] 提前生成草稿失败:", error);
    }
  }
}

export async function dispatchDueMassSends(
  config: Awaited<ReturnType<typeof getAppConfig>>,
  runtimeStores: LocalRuntimeStores,
  now: Date,
): Promise<void> {
  const dueSchedules = await listRecentlyDueSchedules(runtimeStores, now);
  const queue = createScheduledStore(config);

  for (const due of dueSchedules) {
    const record = await queue.get(due.schedule.id);
    if (!record) {
      logger.warn("[定时群发] 到达发送时间，但预生成草稿尚未就绪");
      continue;
    }
    if (record.status === "sent" || record.status === "sending") continue;
    if ((record.attempts ?? 0) >= 3) {
      logger.error("[定时群发] 已连续失败 3 次，停止自动重试");
      continue;
    }
    if (new Date(record.scheduledFor).getTime() > now.getTime()) continue;

    const attempts = (record.attempts ?? 0) + 1;
    await queue.save({ ...record, status: "sending", attempts });
    try {
      const runtimeConfig = await resolveArticleRuntimeConfig(
        runtimeStores.runtimeConfigStore,
        config,
        record.profileId,
        record.accountId,
      );
      const publisher = createArticlePublisher(
        runtimeConfig.config,
        runtimeConfig.account?.id ?? record.accountId,
      );
      const result = await publisher.massSendDraft({
        draftMediaId: record.draftMediaId,
        idempotencyKey: record.idempotencyKey,
      });
      await queue.save({
        ...record,
        status: result.status === "mass-sent" ? "sent" : "sending",
        attempts,
        result,
      });
      await runtimeStores.runtimeConfigStore.markScheduleTriggered(
        due.schedule.id,
        record.scheduleSlot,
      );
      logger.info(`[定时群发] ${record.title}: ${result.status}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await queue.save({
        ...record,
        status: "failed",
        attempts,
        error: message,
      });
      logger.error(`[定时群发] 群发失败: ${message}`);
    }
  }
}

async function listRecentlyDueSchedules(
  runtimeStores: LocalRuntimeStores,
  now: Date,
) {
  const unique = new Map<
    string,
    Awaited<
      ReturnType<
        LocalRuntimeStores["runtimeConfigStore"]["listDueSchedules"]
      >
    >[number]
  >();
  // 允许草稿生成稍有延迟；当天 11:00 未就绪时，后续心跳会继续补发。
  for (let minutesAgo = 0; minutesAgo <= 30; minutesAgo += 5) {
    const time = new Date(now.getTime() - minutesAgo * 60 * 1000);
    for (
      const due of await runtimeStores.runtimeConfigStore.listDueSchedules(time)
    ) {
      unique.set(`${due.schedule.id}:${due.slot}`, due);
    }
  }
  return [...unique.values()];
}

function createScheduledStore(
  config: Awaited<ReturnType<typeof getAppConfig>>,
): LocalScheduledMassSendStore {
  const outputDir = config.storage.artifacts.outputDir ||
    config.storage.runState.outputDir || "src/temp";
  return new LocalScheduledMassSendStore(join(Deno.cwd(), outputDir));
}

async function readRunJson<T>(
  runtimeStores: LocalRuntimeStores,
  runId: string,
  name: string,
): Promise<T> {
  const key = runtimeStores.artifactStore.createRunKey(runId, name, "json");
  const object = await runtimeStores.artifactStore.getObject(key);
  if (!object) throw new Error(`运行产物不存在: ${key}`);
  return JSON.parse(new TextDecoder().decode(object.body)) as T;
}
