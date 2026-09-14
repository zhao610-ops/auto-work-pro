import { assertEquals, assertThrows } from "@std/assert";
import { ToutiaoRelayError } from "./errors.ts";
import {
  nextDailyBeijingTime,
  resolveToutiaoScheduleTarget,
} from "./schedule.ts";

Deno.test("nextDailyBeijingTime uses today before 11:00 Beijing time", () => {
  const now = new Date("2026-09-14T01:00:00.000Z");
  const target = nextDailyBeijingTime(now, "11:00");

  assertEquals(target.toISOString(), "2026-09-14T03:00:00.000Z");
});

Deno.test("nextDailyBeijingTime uses tomorrow after 11:00 Beijing time", () => {
  const now = new Date("2026-09-14T04:00:00.000Z");
  const target = nextDailyBeijingTime(now, "11:00");

  assertEquals(target.toISOString(), "2026-09-15T03:00:00.000Z");
});

Deno.test("resolveToutiaoScheduleTarget formats next 11:00 target", () => {
  const target = resolveToutiaoScheduleTarget(
    new Date("2026-09-14T04:00:00.000Z"),
    "11:00",
  );

  assertEquals(target.dateLabel, "09月15日");
  assertEquals(target.hour, "11");
  assertEquals(target.minute, "00");
  assertEquals(target.display, "2026-09-15 11:00");
});

Deno.test("resolveToutiaoScheduleTarget rejects time outside Toutiao window", () => {
  assertThrows(
    () =>
      resolveToutiaoScheduleTarget(
        new Date("2026-09-14T04:00:00.000Z"),
        "11:00",
        "2026-09-14T04:30:00.000Z",
      ),
    ToutiaoRelayError,
    "2 小时至 7 天",
  );
});
