import { Logger } from "@zilla/logger";
import { MetricsCollector } from "@src/core/workflow/workflow-metrics.ts";
import { RetryOptions, RetryUtil } from "@src/utils/retry.util.ts";
import {
  WorkflowStepError,
  WorkflowTerminateError,
} from "@src/core/workflow/workflow-error.ts";
import { withLoggerContext } from "@src/core/logger/logger-context.ts";
import type {
  WorkflowStepOptions,
} from "@src/core/workflow/workflow-runtime.ts";

const logger = new Logger("workflow");

// 工作流步骤类
export class WorkflowStep {
  private stepId: string;
  private startTime: number;
  private metricsCollector?: MetricsCollector;
  private workflowId?: string;
  private eventId?: string;

  constructor(
    stepId: string,
    metricsCollector?: MetricsCollector,
    workflowId?: string,
    eventId?: string,
  ) {
    this.stepId = stepId;
    this.startTime = Date.now();
    this.metricsCollector = metricsCollector;
    this.workflowId = workflowId;
    this.eventId = eventId;
  }

  async do<T>(
    name: string,
    optionsOrFn: WorkflowStepOptions | (() => Promise<T>),
    fn?: () => Promise<T>,
  ): Promise<T> {
    return await withLoggerContext(
      { step: name },
      async () => await this.executeStep(name, optionsOrFn, fn),
    );
  }

  private async executeStep<T>(
    name: string,
    optionsOrFn: WorkflowStepOptions | (() => Promise<T>),
    fn?: () => Promise<T>,
  ): Promise<T> {
    const options: WorkflowStepOptions = typeof optionsOrFn === "function"
      ? {}
      : optionsOrFn;
    const execFn = typeof optionsOrFn === "function" ? optionsOrFn : fn!;
    const stepStartTime = Date.now();

    try {
      // 转换为RetryUtil的选项格式
      const retryOptions: RetryOptions = {
        maxRetries: options.retries?.limit ?? 3,
        baseDelay: this.parseDelay(options.retries?.delay ?? "1 second"),
        useExponentialBackoff: options.retries?.backoff === "exponential",
      };

      // 包装执行函数，添加超时控制
      const timeoutMs = this.parseDelay(options.timeout || "30 minutes");
      const operationWithTimeout = async () => {
        try {
          return await this.executeWithTimeout(execFn, timeoutMs);
        } catch (error) {
          // 如果是终止错误，直接抛出，不进行重试
          if (error instanceof WorkflowTerminateError) {
            throw error;
          }
          // 其他错误包装为 WorkflowStepError
          throw new WorkflowStepError(
            error instanceof Error ? error.message : String(error),
          );
        }
      };

      // 使用RetryUtil执行操作并获取详细信息
      const retryResult = await RetryUtil.retryOperationWithStats(
        operationWithTimeout,
        retryOptions,
      );

      if (this.metricsCollector && this.workflowId && this.eventId) {
        this.metricsCollector.recordStep(this.workflowId, this.eventId, {
          stepId: this.stepId,
          name,
          startTime: stepStartTime,
          endTime: Date.now(),
          status: retryResult.success ? "success" : "failure",
          attempts: retryResult.attempts,
          error: retryResult.error?.message,
        });
      }

      if (!retryResult.success) {
        throw retryResult.error;
      }

      logger.info(
        `Step ${name} completed successfully after ${retryResult.attempts} attempts, time: ${
          Date.now() - stepStartTime
        }ms`,
      );
      return retryResult.result;
    } catch (error) {
      // 如果是终止错误，记录日志后直接抛出
      if (error instanceof WorkflowTerminateError) {
        logger.error(`Step ${name} terminated: ${error.message}`);
        if (this.metricsCollector && this.workflowId && this.eventId) {
          this.metricsCollector.recordStep(this.workflowId, this.eventId, {
            stepId: this.stepId,
            name,
            startTime: stepStartTime,
            endTime: Date.now(),
            status: "failure",
            attempts: 1,
            error: `Terminated: ${error.message}`,
          });
        }
        throw error;
      }

      logger.error(`Step ${name} failed: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  async sleep(reason: string, duration: string | number): Promise<void> {
    const ms = this.parseDelay(duration);
    logger.info(`Sleeping for ${ms}ms: ${reason}`);
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeout: number,
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        fn(),
        new Promise<T>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("Step timeout")),
            timeout,
          );
        }),
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private parseDelay(delay: string | number): number {
    if (typeof delay === "number") return delay;
    if (delay === "0") return 0;

    const units: Record<string, number> = {
      second: 1000,
      minute: 60 * 1000,
      hour: 60 * 60 * 1000,
      day: 24 * 60 * 60 * 1000,
    };

    const match = delay.match(/^(\d+)\s+(second|minute|hour|day)s?$/);
    if (!match) {
      logger.warn(`Invalid delay format: ${delay}, using 0 as default`);
      return 0;
    }

    const [, value, unit] = match;
    return parseInt(value) * units[unit];
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
