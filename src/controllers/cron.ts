import cron from "npm:node-cron@3.0.3";
import { Logger } from "@zilla/logger";
import { LocalWorkflowRuntime } from "@src/core/workflow/local-workflow-runtime.ts";
import {
  createLocalWeixinArticleWorkflowDefinition,
} from "@src/app/weixin-article/local-workflow.definition.ts";
import { getAppConfig } from "@src/utils/config/app-config.ts";
import { createArticleNotifier } from "@src/app/weixin-article/notifications.ts";
import { createLocalArticleRuntimeStores } from "@src/app/weixin-article/local-runtime-stores.ts";
import { seedArticleRuntimeConfig } from "@src/app/weixin-article/runtime/article-runtime-config.service.ts";
const logger = new Logger("cron");
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
        const dueSchedules = await runtimeStores.runtimeConfigStore
          .listDueSchedules(new Date());
        const runtime = new LocalWorkflowRuntime();
        for (const due of dueSchedules) {
          if (
            !await runtimeStores.runtimeConfigStore.markScheduleTriggered(
              due.schedule.id,
              due.slot,
            )
          ) {
            continue;
          }
          const runId = `cron-${crypto.randomUUID()}`;
          await runtime.run(createLocalWeixinArticleWorkflowDefinition(), {
            payload: {
              runId,
              trigger: "cron",
              dryRun: due.schedule.dryRun,
              profileId: due.schedule.profileId,
            },
            id: runId,
            timestamp: Date.now(),
          });
        }
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
