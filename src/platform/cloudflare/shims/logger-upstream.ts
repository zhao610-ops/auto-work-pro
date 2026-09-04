export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export enum LogLevelOperator {
  GREATER_THAN_OR_EQUAL = "gte",
  LESS_THAN_OR_EQUAL = "lte",
}

export enum TimestampFormat {
  ISO = "iso",
  LOCALE = "locale",
}

interface LogMessage {
  date: Date;
  category: string;
  formatted: string;
  level: LogLevel;
  message: string;
  context?: unknown;
}

export class Logger {
  static level: LogLevel = LogLevel.INFO;
  static levelOperator: LogLevelOperator =
    LogLevelOperator.GREATER_THAN_OR_EQUAL;
  static alignmentCategories: string[] | undefined;

  constructor(public readonly category = "trendpublish") {}

  debug(message: string, context?: unknown): void {
    this.log(message, LogLevel.DEBUG, false, context);
  }

  info(message: string, context?: unknown): void {
    this.log(message, LogLevel.INFO, false, context);
  }

  warn(message: string, context?: unknown): void {
    this.log(message, LogLevel.WARN, false, context);
  }

  error(message: string, context?: unknown): void {
    this.log(message, LogLevel.ERROR, false, context);
  }

  log(
    message: string,
    level: LogLevel,
    throws = false,
    context?: unknown,
  ): void {
    const logMessage = this.message(message, level, context);
    if (this.canLog(level)) {
      this.logMessage(logMessage, throws);
    }
  }

  protected message(
    message: string,
    level: LogLevel,
    context?: unknown,
  ): LogMessage {
    const date = new Date();
    const levelName = LogLevel[level] ?? String(level);
    const formatted =
      `[${levelName}] ${date.toISOString()} [${this.category}] :: ${message}`;
    return {
      date,
      category: this.category,
      formatted,
      level,
      message,
      context,
    };
  }

  protected logMessage(logMessage: LogMessage, throws = false): void {
    const args = logMessage.context === undefined
      ? [logMessage.formatted]
      : [logMessage.formatted, logMessage.context];

    switch (logMessage.level) {
      case LogLevel.DEBUG:
        console.debug(...args);
        break;
      case LogLevel.WARN:
        console.warn(...args);
        break;
      case LogLevel.ERROR:
        console.error(...args);
        break;
      default:
        console.info(...args);
        break;
    }

    if (throws) {
      throw new Error(logMessage.message);
    }
  }

  protected canLog(level: LogLevel): boolean {
    if (Logger.levelOperator === LogLevelOperator.LESS_THAN_OR_EQUAL) {
      return level <= Logger.level;
    }
    return level >= Logger.level;
  }
}
