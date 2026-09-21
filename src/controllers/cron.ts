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
import type {
  RuntimeSchedule,
  RuntimeScheduleTick,
} from "@src/core/ports/runtime-config-store.ts";
import {
  createScheduleSlot,
  isCronDue,
} from "@src/core/storage/runtime-config-utils.ts";
import {
  LocalScheduledMassSendStore,
  type ScheduledMassSendRecord,
} from "@src/platform/local/local-scheduled-mass-send-store.ts";
import { join } from "node:path";
import { processToutiaoSchedule } from "@src/controllers/toutiao-scheduler.ts";
const logger = new Logger("cron");
/** 预留抓取、生成、图片处理和审稿时间；实际群发仍严格等待目标时刻。 */
const PREPARE_LEAD_MS = 30 * 60 * 1000;
const RECOVERY_SCAN_MS = 26 * 60 * 60 * 1000;
/** 同一个排期的生成任务最多独占 30 分钟，防止五分钟心跳重复启动同一 runId。 */
const PREPARATION_LEASE_MS = 30 * 60 * 1000;
const PREPARATION_RETRY_BASE_MS = 10 * 60 * 1000;
const PREPARATION_RETRY_MAX_MS = 30 * 60 * 1000;
/** 微信群发网络请求失去回执后，允许使用同一幂等键恢复一次。 */
const SENDING_LEASE_MS = 6 * 60 * 1000;
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

  let isStartupRecovery = true;
  const runHeartbeat = async () => {
    try {
      logger.info("检查到期微信文章工作流...");
      const runtimeStores = createLocalArticleRuntimeStores(config);
      await seedArticleRuntimeConfig(
        runtimeStores.runtimeConfigStore,
        config,
      );
      const now = new Date();
      const resumeInterruptedPreparation = isStartupRecovery;
      isStartupRecovery = false;
      await prepareUpcomingMassSends(
        config,
        runtimeStores,
        now,
        resumeInterruptedPreparation,
      );
      await dispatchDueMassSends(
        config,
        runtimeStores,
        now,
        resumeInterruptedPreparation,
      );
      await processToutiaoSchedule(config, now);
    } catch (error) {
      logger.error(`工作流执行失败:`, error);
      notifier.notify("工作流执行失败", String(error));
    }
  };

  // 服务重启后不等待下一个五分钟整点，立即补偿当天未完成的任务。
  await runHeartbeat();

  // Heartbeat 调度：具体业务时间由 Dashboard runtime config 控制。
  cron.schedule(
    "*/5 * * * *",
    runHeartbeat,
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
  resumeInterruptedPreparation = false,
): Promise<void> {
  const dueSchedules = await listRecoverableMassSendSchedules(
    runtimeStores,
    now,
  );
  const queue = createScheduledStore(config);

  for (const due of dueSchedules) {
    const scheduledFor = scheduleSlotToDate(due.slot, due.schedule.timezone);
    if (scheduledFor.getTime() > now.getTime() + PREPARE_LEAD_MS) continue;
    const existing = await queue.get(due.schedule.id);
    if (existing?.scheduleSlot === due.slot) {
      if (!isPreparationRetryDue(existing, now)) {
        logger.info(
          `[定时群发] 等待下一次补生成: ${existing.nextPreparationAt}`,
        );
        continue;
      }
      if (
        !resumeInterruptedPreparation &&
        hasActivePreparationLease(existing, now)
      ) {
        logger.info(
          `[定时群发] 草稿仍在生成，保留当前任务: ${existing.sourceRunId}`,
        );
        continue;
      }
      if (
        existing.status === "prepared" || existing.status === "sending" ||
        existing.status === "sent" ||
        (existing.status === "failed" && existing.draftMediaId)
      ) {
        continue;
      }
    }

    const preparationAttempt = existing?.scheduleSlot === due.slot
      ? (existing.preparationAttempts ?? 0) + 1
      : 1;
    const runId = createPreparationRunId(due, preparationAttempt);
    const idempotencyKey = createMassSendIdempotencyKey(due);
    // 先保存恢复记录。重启恢复时使用新的运行目录，但群发幂等键保持不变。
    await queue.save({
      scheduleId: due.schedule.id,
      scheduleSlot: due.slot,
      profileId: due.schedule.profileId,
      sourceRunId: runId,
      scheduledFor: scheduledFor.toISOString(),
      idempotencyKey,
      status: "preparing",
      preparationAttempts: preparationAttempt,
      attempts: existing?.scheduleSlot === due.slot ? existing.attempts : 0,
    });
    try {
      const runtime = new LocalWorkflowRuntime();
      await runtime.run(createLocalWeixinArticleWorkflowDefinition(), {
        payload: {
          runId,
          trigger: "cron",
          dryRun: due.schedule.dryRun,
          profileId: due.schedule.profileId,
          prepareOnly: true,
          scheduledSendAt: scheduledFor.toISOString(),
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
        const reason = publishResult.reason ?? publishResult.status;
        const retryAt = nextPreparationRetryAt(preparationAttempt);
        await queue.save({
          scheduleId: due.schedule.id,
          scheduleSlot: due.slot,
          profileId: due.schedule.profileId,
          sourceRunId: runId,
          title: title.title,
          scheduledFor: scheduledFor.toISOString(),
          idempotencyKey,
          status: "blocked",
          preparationAttempts: preparationAttempt,
          attempts: existing?.scheduleSlot === due.slot ? existing.attempts : 0,
          nextPreparationAt: retryAt.toISOString(),
          error: reason,
        });
        logger.warn(
          `[定时群发] 草稿未达标，${retryAt.toISOString()} 自动补生成: ${reason}`,
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
        scheduledFor: scheduledFor.toISOString(),
        idempotencyKey,
        status: "prepared",
      });
      await runtimeStores.runtimeConfigStore.markScheduleTriggered(
        `${due.schedule.id}:prepare`,
        due.slot,
      );
      logger.info(
        `[定时群发] 草稿准备完成，将在 ${scheduledFor.toISOString()} 群发: ${title.title}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryAt = nextPreparationRetryAt(preparationAttempt);
      await queue.save({
        scheduleId: due.schedule.id,
        scheduleSlot: due.slot,
        profileId: due.schedule.profileId,
        sourceRunId: runId,
        scheduledFor: scheduledFor.toISOString(),
        idempotencyKey,
        status: "failed",
        preparationAttempts: preparationAttempt,
        attempts: existing?.scheduleSlot === due.slot ? existing.attempts : 0,
        nextPreparationAt: retryAt.toISOString(),
        error: message,
      });
      logger.error(
        `[定时群发] 提前生成失败，${retryAt.toISOString()} 自动补生成:`,
        error,
      );
    }
  }
}

/** 返回 true 时，当前心跳不能再次启动同一排期的工作流。 */
export function hasActivePreparationLease(
  record: ScheduledMassSendRecord,
  now: Date,
): boolean {
  if (record.status !== "preparing") return false;
  const updatedAt = Date.parse(record.updatedAt);
  if (!Number.isFinite(updatedAt)) return false;
  const age = now.getTime() - updatedAt;
  return age >= 0 && age < PREPARATION_LEASE_MS;
}

/** 质量未达标或生成失败时逐步退避，避免每个心跳重复消耗外部 API。 */
export function nextPreparationRetryAt(
  attempt: number,
  now = new Date(),
): Date {
  const delay = Math.min(
    PREPARATION_RETRY_MAX_MS,
    PREPARATION_RETRY_BASE_MS * Math.max(1, Math.min(attempt, 3)),
  );
  return new Date(now.getTime() + delay);
}

export function isPreparationRetryDue(
  record: ScheduledMassSendRecord,
  now: Date,
): boolean {
  if (!record.nextPreparationAt) return true;
  const timestamp = Date.parse(record.nextPreparationAt);
  return !Number.isFinite(timestamp) || timestamp <= now.getTime();
}

export async function dispatchDueMassSends(
  config: Awaited<ReturnType<typeof getAppConfig>>,
  runtimeStores: LocalRuntimeStores,
  now: Date,
  resumeInterruptedSend = false,
): Promise<void> {
  const dueSchedules = await listRecoverableMassSendSchedules(
    runtimeStores,
    now,
  );
  const queue = createScheduledStore(config);

  for (const due of dueSchedules) {
    const record = await queue.get(due.schedule.id);
    if (!record) {
      logger.warn("[定时群发] 到达发送时间，但预生成草稿尚未就绪");
      continue;
    }
    if (record.status === "sent" || record.status === "preparing") continue;
    if (
      (record.status === "blocked" || record.status === "failed") &&
      !record.draftMediaId
    ) continue;
    if (
      record.status === "sending" &&
      !resumeInterruptedSend &&
      hasActiveSendingLease(record, now)
    ) continue;
    if ((record.attempts ?? 0) >= 3) {
      logger.error("[定时群发] 已连续失败 3 次，停止自动重试");
      continue;
    }
    if (new Date(record.scheduledFor).getTime() > now.getTime()) continue;
    if (!record.draftMediaId || !record.title) {
      logger.warn("[定时群发] 草稿记录不完整，等待恢复生成");
      continue;
    }

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
        status: result.status === "mass-sent"
          ? "sent"
          : result.status === "mass-sending"
          ? "sending"
          : "failed",
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

/** 正常的群发请求尚未返回时，避免并发重发；服务重启或租约到期后可幂等恢复。 */
export function hasActiveSendingLease(
  record: ScheduledMassSendRecord,
  now: Date,
): boolean {
  if (record.status !== "sending") return false;
  const updatedAt = Date.parse(record.updatedAt);
  if (!Number.isFinite(updatedAt)) return false;
  const age = now.getTime() - updatedAt;
  return age >= 0 && age < SENDING_LEASE_MS;
}

export async function listRecoverableMassSendSchedules(
  runtimeStores: LocalRuntimeStores,
  now: Date,
): Promise<RuntimeScheduleTick[]> {
  const unique = new Map<
    string,
    RuntimeScheduleTick
  >();
  for (
    const schedule of await runtimeStores.runtimeConfigStore.listSchedules()
  ) {
    if (!schedule.enabled) continue;
    const due = findRecoverableScheduleTick(schedule, now);
    if (due) unique.set(`${due.schedule.id}:${due.slot}`, due);
  }
  return [...unique.values()];
}

function findRecoverableScheduleTick(
  schedule: RuntimeSchedule,
  now: Date,
): RuntimeScheduleTick | null {
  const today = localDateKey(now, schedule.timezone);
  const start = new Date(now.getTime() - RECOVERY_SCAN_MS);
  start.setSeconds(0, 0);
  const end = new Date(now.getTime() + PREPARE_LEAD_MS);
  end.setSeconds(0, 0);
  let latestPast: RuntimeScheduleTick | null = null;
  let earliestFuture: RuntimeScheduleTick | null = null;

  for (
    let cursor = new Date(start);
    cursor.getTime() <= end.getTime();
    cursor = new Date(cursor.getTime() + 60_000)
  ) {
    if (
      localDateKey(cursor, schedule.timezone) !== today ||
      !isCronDue(schedule.cron, cursor, schedule.timezone)
    ) continue;
    const tick = {
      schedule,
      slot: createScheduleSlot(schedule.id, cursor, schedule.timezone),
    };
    if (cursor.getTime() <= now.getTime()) latestPast = tick;
    else if (!earliestFuture) earliestFuture = tick;
  }
  return latestPast ?? earliestFuture;
}

function localDateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function scheduleSlotToDate(slot: string, timezone: string): Date {
  const match = slot.match(/:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}):/);
  if (!match) throw new Error(`无法解析定时任务时段: ${slot}`);
  const [date, time] = match[1].split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  // 将“时区内的 11:00”反推为真实 UTC 时间；两轮足以覆盖普通时区及夏令时切换。
  let timestamp = target;
  for (let round = 0; round < 2; round++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(timestamp));
    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );
    const actual = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
    );
    timestamp += target - actual;
  }
  return new Date(timestamp);
}

function createPreparationRunId(
  due: RuntimeScheduleTick,
  attempt: number,
): string {
  return `cron-prepare-${stableHash(due.slot)}-${Math.max(1, attempt)}`;
}

function createMassSendIdempotencyKey(due: RuntimeScheduleTick): string {
  return `scheduled-${stableHash(due.slot)}`;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
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
