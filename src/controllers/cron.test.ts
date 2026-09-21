import { assertEquals } from "@std/assert";
import type { RuntimeSchedule } from "@src/core/ports/runtime-config-store.ts";
import {
  hasActivePreparationLease,
  hasActiveSendingLease,
  isPreparationRetryDue,
  listRecoverableMassSendSchedules,
  nextPreparationRetryAt,
  scheduleSlotToDate,
} from "./cron.ts";

const dailyEleven: RuntimeSchedule = {
  id: "daily-eleven",
  featureKey: "article",
  profileId: "article-default",
  name: "每日 11 点群发",
  enabled: true,
  cron: "0 11 * * *",
  timezone: "Asia/Shanghai",
  dryRun: false,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

function runtimeStores(schedules: RuntimeSchedule[]) {
  return {
    runtimeConfigStore: {
      listSchedules: () => Promise.resolve(schedules),
    },
  } as Parameters<typeof listRecoverableMassSendSchedules>[0];
}

Deno.test("服务在 10:35 时，开始准备当天 11:00 的群发草稿", async () => {
  const due = await listRecoverableMassSendSchedules(
    runtimeStores([dailyEleven]),
    new Date("2026-09-17T02:35:00.000Z"),
  );

  assertEquals(due.map((item) => item.slot), [
    "daily-eleven:2026-09-17T11:00:Asia/Shanghai",
  ]);
});

Deno.test("服务在 11:05 恢复时，会找回当天错过的 11:00 任务", async () => {
  const due = await listRecoverableMassSendSchedules(
    runtimeStores([dailyEleven]),
    new Date("2026-09-17T03:05:00.000Z"),
  );

  assertEquals(due.map((item) => item.slot), [
    "daily-eleven:2026-09-17T11:00:Asia/Shanghai",
  ]);
});

Deno.test("距离群发超过三十分钟时不会提前准备", async () => {
  const due = await listRecoverableMassSendSchedules(
    runtimeStores([dailyEleven]),
    new Date("2026-09-17T01:30:00.000Z"),
  );

  assertEquals(due, []);
});

Deno.test("定时槽位可以还原为正确的北京时间发送时刻", () => {
  const scheduledFor = scheduleSlotToDate(
    "daily-eleven:2026-09-17T11:00:Asia/Shanghai",
    "Asia/Shanghai",
  );
  assertEquals(scheduledFor.toISOString(), "2026-09-17T03:00:00.000Z");
});

Deno.test("生成中的草稿在租约内不会被下一次心跳重复启动", () => {
  const now = new Date("2026-09-17T03:00:00.000Z");
  assertEquals(
    hasActivePreparationLease({
      scheduleId: "daily-eleven",
      scheduleSlot: "daily-eleven:2026-09-17T11:00:Asia/Shanghai",
      profileId: "article-default",
      sourceRunId: "cron-prepare-example",
      scheduledFor: now.toISOString(),
      idempotencyKey: "scheduled-example",
      status: "preparing",
      updatedAt: "2026-09-17T02:50:00.000Z",
    }, now),
    true,
  );
});

Deno.test("超过租约的生成记录允许恢复", () => {
  const now = new Date("2026-09-17T03:31:00.000Z");
  assertEquals(
    hasActivePreparationLease({
      scheduleId: "daily-eleven",
      scheduleSlot: "daily-eleven:2026-09-17T11:00:Asia/Shanghai",
      profileId: "article-default",
      sourceRunId: "cron-prepare-example",
      scheduledFor: "2026-09-17T03:00:00.000Z",
      idempotencyKey: "scheduled-example",
      status: "preparing",
      updatedAt: "2026-09-17T03:00:00.000Z",
    }, now),
    false,
  );
});

Deno.test("质量不达标的草稿按退避时间自动补生成", () => {
  const now = new Date("2026-09-17T03:00:00.000Z");
  const retryAt = nextPreparationRetryAt(2, now);
  assertEquals(retryAt.toISOString(), "2026-09-17T03:20:00.000Z");
  const record = {
    scheduleId: "daily-eleven",
    scheduleSlot: "daily-eleven:2026-09-17T11:00:Asia/Shanghai",
    profileId: "article-default",
    sourceRunId: "cron-prepare-example",
    scheduledFor: now.toISOString(),
    idempotencyKey: "scheduled-example",
    status: "blocked" as const,
    nextPreparationAt: retryAt.toISOString(),
    updatedAt: now.toISOString(),
  };
  assertEquals(isPreparationRetryDue(record, now), false);
  assertEquals(isPreparationRetryDue(record, retryAt), true);
});

Deno.test("发送中的群发在租约内不会被重复调用", () => {
  const now = new Date("2026-09-17T03:00:00.000Z");
  assertEquals(
    hasActiveSendingLease({
      scheduleId: "daily-eleven",
      scheduleSlot: "daily-eleven:2026-09-17T11:00:Asia/Shanghai",
      profileId: "article-default",
      sourceRunId: "cron-prepare-example",
      scheduledFor: now.toISOString(),
      idempotencyKey: "scheduled-example",
      status: "sending",
      updatedAt: "2026-09-17T02:55:00.000Z",
    }, now),
    true,
  );
});

Deno.test("超时的发送状态允许用原幂等键恢复", () => {
  const now = new Date("2026-09-17T03:07:00.000Z");
  assertEquals(
    hasActiveSendingLease({
      scheduleId: "daily-eleven",
      scheduleSlot: "daily-eleven:2026-09-17T11:00:Asia/Shanghai",
      profileId: "article-default",
      sourceRunId: "cron-prepare-example",
      scheduledFor: "2026-09-17T03:00:00.000Z",
      idempotencyKey: "scheduled-example",
      status: "sending",
      updatedAt: "2026-09-17T03:00:00.000Z",
    }, now),
    false,
  );
});
