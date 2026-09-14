import { ToutiaoRelayError } from "./errors.ts";

const BEIJING_TIME_ZONE = "Asia/Shanghai";
const MIN_SCHEDULE_DELAY_MS = 2 * 60 * 60 * 1000;
const MAX_SCHEDULE_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

export interface ToutiaoScheduleTarget {
  at: Date;
  dateLabel: string;
  hour: string;
  minute: string;
  display: string;
}

export function resolveToutiaoScheduleTarget(
  now: Date,
  defaultTime: string,
  scheduledAt?: string,
): ToutiaoScheduleTarget {
  const target = scheduledAt
    ? parseRequestedTime(scheduledAt)
    : nextDailyBeijingTime(now, defaultTime);
  assertScheduleWindow(now, target);
  return toScheduleTarget(target);
}

export function nextDailyBeijingTime(now: Date, time: string): Date {
  const { hour, minute } = parseTime(time);
  const parts = beijingParts(now);
  let target = beijingDate(parts.year, parts.month, parts.day, hour, minute);
  if (target.getTime() <= now.getTime()) {
    target = new Date(target.getTime() + 24 * 60 * 60 * 1000);
  }
  return target;
}

function parseRequestedTime(value: string): Date {
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) {
    throw new ToutiaoRelayError(
      "SCHEDULE_TIME_INVALID",
      "scheduledAt 必须是有效的 ISO 时间",
    );
  }
  return target;
}

function parseTime(value: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  if (!match || hour > 23 || minute > 59) {
    throw new ToutiaoRelayError(
      "SCHEDULE_TIME_INVALID",
      "TOUTIAO_DEFAULT_SCHEDULE_TIME 必须为 HH:mm 格式",
    );
  }
  return { hour, minute };
}

function assertScheduleWindow(now: Date, target: Date): void {
  const delay = target.getTime() - now.getTime();
  if (delay < MIN_SCHEDULE_DELAY_MS || delay > MAX_SCHEDULE_DELAY_MS) {
    throw new ToutiaoRelayError(
      "SCHEDULE_WINDOW_INVALID",
      "今日头条定时发布时间必须在当前时间后 2 小时至 7 天内",
      { target: target.toISOString() },
    );
  }
}

function toScheduleTarget(at: Date): ToutiaoScheduleTarget {
  const parts = beijingParts(at);
  return {
    at,
    dateLabel: `${String(parts.month).padStart(2, "0")}月${
      String(parts.day).padStart(2, "0")
    }日`,
    hour: String(parts.hour),
    minute: String(parts.minute).padStart(2, "0"),
    display: `${parts.year}-${String(parts.month).padStart(2, "0")}-${
      String(parts.day).padStart(2, "0")
    } ${String(parts.hour).padStart(2, "0")}:${
      String(parts.minute).padStart(2, "0")
    }`,
  };
}

function beijingParts(
  date: Date,
): Record<"year" | "month" | "day" | "hour" | "minute", number> {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return values as Record<"year" | "month" | "day" | "hour" | "minute", number>;
}

function beijingDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute));
}
