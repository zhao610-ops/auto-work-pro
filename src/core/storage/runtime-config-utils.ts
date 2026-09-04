import type {
  CapabilityKind,
  CapabilityProfile,
  JsonObject,
  RuntimeFeatureProfile,
  RuntimeSchedule,
  WeixinAccountProfile,
} from "@src/core/ports/runtime-config-store.ts";

export interface CapabilityProfileRow {
  id: string;
  kind: CapabilityKind;
  name: string;
  enabled: number;
  provider: string;
  config_json: string | null;
  version: number;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export interface FeatureProfileRow {
  id: string;
  feature_key: string;
  name: string;
  enabled: number;
  is_default: number;
  config_json: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface RuntimeScheduleRow {
  id: string;
  feature_key: string;
  profile_id: string;
  name: string;
  enabled: number;
  cron: string;
  timezone: string;
  dry_run: number;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WeixinAccountProfileRow {
  id: string;
  name: string;
  enabled: number;
  default_article_profile_id: string | null;
  brand_json: string | null;
  defaults_json: string | null;
  ops_json?: string | null;
  created_at: string;
  updated_at: string;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function rowToCapabilityProfile(
  row: CapabilityProfileRow,
): CapabilityProfile {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    enabled: Boolean(row.enabled),
    provider: row.provider,
    config: parseJsonObject(row.config_json),
    version: Number(row.version),
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToFeatureProfile(
  row: FeatureProfileRow,
): RuntimeFeatureProfile {
  return {
    id: row.id,
    featureKey: row.feature_key,
    name: row.name,
    enabled: Boolean(row.enabled),
    isDefault: Boolean(row.is_default),
    config: parseJsonObject(row.config_json),
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToRuntimeSchedule(
  row: RuntimeScheduleRow,
): RuntimeSchedule {
  return {
    id: row.id,
    featureKey: row.feature_key,
    profileId: row.profile_id,
    name: row.name,
    enabled: Boolean(row.enabled),
    cron: row.cron,
    timezone: row.timezone,
    dryRun: Boolean(row.dry_run),
    lastTriggeredAt: row.last_triggered_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToWeixinAccountProfile(
  row: WeixinAccountProfileRow,
): WeixinAccountProfile {
  return {
    id: row.id,
    name: row.name,
    enabled: Boolean(row.enabled),
    defaultArticleProfileId: row.default_article_profile_id ?? undefined,
    brand: parseJsonObject(row.brand_json),
    defaults: parseJsonObject(row.defaults_json),
    ops: parseJsonObject(row.ops_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function parseJsonObject(value: string | null | undefined): JsonObject {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as JsonObject;
    }
  } catch {
    // fall through
  }
  return {};
}

export function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    // fall through
  }
  return [];
}

export function isCronDue(cron: string, now: Date, timezone: string): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`暂不支持的 cron 表达式: ${cron}`);
  }
  const local = getLocalDateParts(now, timezone);
  return matchesCronPart(parts[0], local.minute, 0, 59) &&
    matchesCronPart(parts[1], local.hour, 0, 23) &&
    matchesCronPart(parts[2], local.day, 1, 31) &&
    matchesCronPart(parts[3], local.month, 1, 12) &&
    matchesCronPart(parts[4], local.weekday, 0, 6);
}

export function createScheduleSlot(
  scheduleId: string,
  now: Date,
  timezone: string,
): string {
  const local = getLocalDateParts(now, timezone);
  return `${scheduleId}:${local.year}-${pad(local.month)}-${pad(local.day)}T${
    pad(local.hour)
  }:${pad(local.minute)}:${timezone}`;
}

function matchesCronPart(
  part: string,
  value: number,
  min: number,
  max: number,
): boolean {
  if (part === "*") return true;
  return part.split(",").some((segment) => {
    const stepMatch = segment.match(/^\*\/(\d+)$/);
    if (stepMatch) {
      const step = Number(stepMatch[1]);
      return step > 0 && (value - min) % step === 0;
    }
    const rangeStepMatch = segment.match(/^(\d+)-(\d+)\/(\d+)$/);
    if (rangeStepMatch) {
      const start = Number(rangeStepMatch[1]);
      const end = Number(rangeStepMatch[2]);
      const step = Number(rangeStepMatch[3]);
      return value >= start && value <= end && step > 0 &&
        (value - start) % step === 0;
    }
    const rangeMatch = segment.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      return value >= Number(rangeMatch[1]) && value <= Number(rangeMatch[2]);
    }
    const numeric = Number(segment);
    return Number.isInteger(numeric) && numeric >= min && numeric <= max &&
      numeric === value;
  });
}

function getLocalDateParts(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "0";
  const weekdayName = get("weekday");
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: weekdayToNumber(weekdayName),
  };
}

function weekdayToNumber(value: string): number {
  switch (value.toLowerCase().slice(0, 3)) {
    case "sun":
      return 0;
    case "mon":
      return 1;
    case "tue":
      return 2;
    case "wed":
      return 3;
    case "thu":
      return 4;
    case "fri":
      return 5;
    case "sat":
      return 6;
    default:
      return 0;
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
