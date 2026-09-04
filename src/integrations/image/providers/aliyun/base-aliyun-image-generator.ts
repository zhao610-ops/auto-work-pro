import { BaseImageGenerator } from "@src/integrations/image/providers/base-image-generator.ts";
import axios from "npm:axios@1.8.3";
import { Logger } from "@zilla/logger";

const logger = new Logger("aliyun");
const ALIYUN_SUBMIT_TIMEOUT_MS = 30_000;
const ALIYUN_STATUS_TIMEOUT_MS = 30_000;
const ALIYUN_MULTIMODAL_TIMEOUT_MS = 120_000;
const ALIYUN_TASK_MAX_WAIT_MS = 120_000;

/**
 * 阿里云基础任务响应接口
 */
export interface AliTaskResponse {
  request_id: string;
  output: {
    task_status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
    task_id: string;
  };
}

export interface AliTaskOutput {
  task_status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  task_id?: string;
  results?: Array<{ url: string }>;
  render_urls?: string[];
  [key: string]: unknown;
}

/**
 * 阿里云基础任务状态响应接口
 */
export interface AliTaskStatusResponse {
  request_id: string;
  output: AliTaskOutput;
}

interface AliyunMultimodalGenerationResponse {
  request_id?: string;
  output?: {
    choices?: Array<{
      message?: {
        content?: Array<{
          image?: string;
          url?: string;
          text?: string;
          [key: string]: unknown;
        }>;
      };
    }>;
  };
}

/**
 * 阿里云图像生成器基类
 * 提供阿里云服务通用的配置和方法
 */
export abstract class BaseAliyunImageGenerator<
  TRequest = Record<string, unknown>,
  TResult extends string = string,
> extends BaseImageGenerator<TRequest, TResult> {
  protected apiKey!: string;
  protected baseUrl!: string;
  protected model!: string;

  constructor(private readonly configuredApiKey?: string) {
    super();
  }

  /**
   * 刷新配置
   * 从配置管理器中获取最新的API密钥
   */
  async refresh(): Promise<void> {
    const apiKey = this.configuredApiKey;
    if (!apiKey) {
      throw new Error("providers.image.dashscope.apiKey is not set");
    }
    this.apiKey = apiKey;
  }

  /**
   * 生成随机种子
   * @returns 1到4294967290之间的随机整数
   */
  protected generateSeed(): number {
    return Math.floor(Math.random() * 4294967290) + 1;
  }
  /**
   * 提交任务到阿里云服务
   */
  protected async submitTask<T extends AliTaskResponse>(
    payload: Record<string, unknown>,
  ): Promise<T> {
    try {
      logger.debug(`提交任务到阿里云服务: ${this.baseUrl}`, {
        model: this.model,
        ...payload,
      });
      const response = await axios.post<T>(
        this.baseUrl,
        {
          model: this.model,
          ...payload,
        },
        {
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.apiKey}`,
            "X-DashScope-Async": "enable",
          },
          timeout: ALIYUN_SUBMIT_TIMEOUT_MS,
        },
      );
      logger.debug(`阿里云API调用成功: ${response.data.request_id}`, {
        model: this.model,
        response: response.data,
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `阿里云API调用失败: ${
            error.response?.data?.message || error.message
          }`,
        );
      }
      throw error;
    }
  }

  /**
   * 检查任务状态
   */
  protected async checkTaskStatus(
    taskId: string,
  ): Promise<AliTaskStatusResponse["output"]> {
    try {
      const response = await axios.get<AliTaskStatusResponse>(
        `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`,
        {
          headers: {
            "Authorization": `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: ALIYUN_STATUS_TIMEOUT_MS,
        },
      );
      return response.data.output;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `任务状态检查失败: ${error.response?.data?.message || error.message}`,
        );
      }
      throw error;
    }
  }

  protected async generateMultimodalImage(
    model: string,
    prompt: string,
    parameters: Record<string, unknown> = {},
  ): Promise<string> {
    try {
      const response = await axios.post<AliyunMultimodalGenerationResponse>(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
        {
          model,
          input: {
            messages: [
              {
                role: "user",
                content: [{ text: prompt }],
              },
            ],
          },
          parameters,
        },
        {
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.apiKey}`,
          },
          timeout: ALIYUN_MULTIMODAL_TIMEOUT_MS,
        },
      );
      return extractMultimodalImageUrl(response.data);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `阿里云图片生成失败: ${
            error.response?.data?.message || error.message
          }`,
        );
      }
      throw error;
    }
  }

  /**
   * 获取结果
   */
  protected abstract getResult(output: AliTaskStatusResponse["output"]): string;

  /**
   * 等待任务完成
   */
  protected async waitForCompletion(
    taskId: string,
    maxAttempts: number = 30,
    interval: number = 2000,
  ): Promise<string> {
    let attempts = 0;
    const deadline = Date.now() + ALIYUN_TASK_MAX_WAIT_MS;

    while (attempts < maxAttempts && Date.now() < deadline) {
      const status = await this.checkTaskStatus(taskId);

      if (status.task_status === "SUCCEEDED") {
        return await this.getResult(status);
      }

      if (status.task_status === "FAILED") {
        throw new Error(`图片生成任务失败: ${JSON.stringify(status)}`);
      }

      await new Promise((resolve) => setTimeout(resolve, interval));
      attempts++;
    }

    throw new Error(
      `等待图片生成超时: taskId=${taskId}, attempts=${attempts}`,
    );
  }

  /**
   * 数值范围限制工具方法
   */
  protected clampValue(
    value: number | undefined,
    min: number,
    max: number,
    defaultValue: number,
  ): number {
    if (value === undefined) return defaultValue;
    return Math.min(Math.max(value, min), max);
  }
}

function extractMultimodalImageUrl(
  response: AliyunMultimodalGenerationResponse,
): string {
  for (const choice of response.output?.choices ?? []) {
    for (const item of choice.message?.content ?? []) {
      if (typeof item.image === "string" && item.image.trim()) {
        return item.image;
      }
      if (typeof item.url === "string" && item.url.trim()) {
        return item.url;
      }
    }
  }
  throw new Error("阿里云图片生成成功但未返回图片 URL");
}
