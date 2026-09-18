import { assertEquals } from "@std/assert";
import {
  currentOrNextBeijingDailyTime,
  nextBeijingDailyTime,
} from "./toutiao-scheduler.ts";

Deno.test("头条调度在北京时间 11 点前选择当天目标", () => {
  assertEquals(
    nextBeijingDailyTime(new Date("2026-09-16T00:00:00.000Z"), "11:00")
      .toISOString(),
    "2026-09-16T03:00:00.000Z",
  );
});

Deno.test("头条调度在北京时间 11 点后选择次日目标", () => {
  assertEquals(
    nextBeijingDailyTime(new Date("2026-09-16T04:00:00.000Z"), "11:00")
      .toISOString(),
    "2026-09-17T03:00:00.000Z",
  );
});

Deno.test("头条系统直接发布允许目标时间后的心跳处理当天任务", () => {
  assertEquals(
    currentOrNextBeijingDailyTime(
      new Date("2026-09-16T03:05:00.000Z"),
      "11:00",
    ).toISOString(),
    "2026-09-16T03:00:00.000Z",
  );
});

Deno.test("头条系统直接发布不会补发超过宽限窗口的当天旧任务", () => {
  assertEquals(
    currentOrNextBeijingDailyTime(
      new Date("2026-09-16T03:16:00.000Z"),
      "11:00",
    ).toISOString(),
    "2026-09-17T03:00:00.000Z",
  );
});
