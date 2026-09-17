import { assertEquals } from "@std/assert";
import { nextBeijingDailyTime } from "./toutiao-scheduler.ts";

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
