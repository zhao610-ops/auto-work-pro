import {
  Logger as UpstreamLogger,
  LogLevel,
  LogLevelOperator,
  TimestampFormat,
} from "@zilla/logger-upstream";
import { getLoggerContext } from "@src/core/logger/logger-context.ts";

export { LogLevel, LogLevelOperator, TimestampFormat };

export interface LoggerRecord {
  timestamp: string;
  level: LogLevel;
  levelName: string;
  category?: string;
  message: string;
  formatted: string;
  context?: unknown;
  runId?: string;
  workflowId?: string;
  step?: string;
  profileId?: string;
  mode?: string;
  dryRun?: boolean;
  trigger?: string;
}

export type LoggerObserver = (
  record: LoggerRecord,
) => void | Promise<void>;

const observers = new Set<LoggerObserver>();

export function addLoggerObserver(observer: LoggerObserver): () => void {
  observers.add(observer);
  return () => observers.delete(observer);
}

export function clearLoggerObservers(): void {
  observers.clear();
}

export class Logger extends UpstreamLogger {
  static override get level(): LogLevel {
    return UpstreamLogger.level;
  }

  static override set level(value: LogLevel) {
    UpstreamLogger.level = value;
  }

  static override get levelOperator(): LogLevelOperator {
    return UpstreamLogger.levelOperator;
  }

  static override set levelOperator(value: LogLevelOperator) {
    UpstreamLogger.levelOperator = value;
  }

  static override get alignmentCategories(): string[] | undefined {
    return UpstreamLogger.alignmentCategories;
  }

  static override set alignmentCategories(value: string[] | undefined) {
    UpstreamLogger.alignmentCategories = value;
  }

  override log(
    message: string,
    level: LogLevel,
    throws?: boolean,
    context?: unknown,
  ) {
    const logMessage = this.message(message, level, context);
    if (canLog(this, level)) {
      const activeContext = getLoggerContext();
      const explicitContext = readRecordContext(context);
      notifyObservers({
        timestamp: logMessage.date.toISOString(),
        level,
        levelName: getLogLevelName(level),
        category: logMessage.category,
        message,
        formatted: logMessage.formatted,
        context,
        runId: explicitContext.runId ?? activeContext.runId,
        workflowId: explicitContext.workflowId ?? activeContext.workflowId,
        step: explicitContext.step ?? activeContext.step,
        profileId: explicitContext.profileId ?? activeContext.profileId,
        mode: explicitContext.mode ?? activeContext.mode,
        dryRun: explicitContext.dryRun ?? activeContext.dryRun,
        trigger: explicitContext.trigger ?? activeContext.trigger,
      });
    }
    return this.logMessage(logMessage, throws);
  }
}

function readRecordContext(context: unknown): Partial<LoggerRecord> {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return {};
  }
  const record = context as Record<string, unknown>;
  return {
    runId: stringValue(record.runId),
    workflowId: stringValue(record.workflowId),
    step: stringValue(record.step),
    profileId: stringValue(record.profileId),
    mode: stringValue(record.mode),
    dryRun: booleanValue(record.dryRun),
    trigger: stringValue(record.trigger),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function canLog(logger: Logger, level: LogLevel): boolean {
  return (
    logger as unknown as { canLog(level: LogLevel): boolean }
  ).canLog(level);
}

function getLogLevelName(level: LogLevel): string {
  return LogLevel[level] ?? String(level);
}

function notifyObservers(record: LoggerRecord): void {
  for (const observer of observers) {
    queueMicrotask(async () => {
      try {
        await observer(record);
      } catch {
        // Observability must never break normal logging or business flow.
      }
    });
  }
}
