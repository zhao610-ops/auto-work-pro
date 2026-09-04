import {
  HttpClient,
  HttpError,
  NetworkError,
  TimeoutError,
} from "@src/utils/http/http-client.ts";
import {
  ChatCompletionOptions,
  ChatCompletionResponse,
  ChatMessage,
  LLMProvider,
} from "@src/core/ports/llm.ts";
import { ResolvedTrendPublishConfig } from "@src/utils/config/define-config.ts";
import { normalizeLLMResponse } from "@src/utils/llm-output.ts";
import {
  classifyHttpProviderError,
  ProviderError,
} from "@src/core/errors/provider-error.ts";
import { redactSensitiveText } from "@src/utils/security/redact.ts";

type LLMConfig = ResolvedTrendPublishConfig["providers"]["ai"];

interface OpenAICompatibleHttpClient {
  request<T>(
    url: string,
    options?: RequestInit & {
      timeout?: number;
      retries?: number;
      retryDelay?: number;
    },
  ): Promise<T>;
}

export class OpenAICompatibleLLM implements LLMProvider {
  private baseURL!: string;
  private token!: string;
  private defaultModel!: string;
  private availableModels: string[] = [];
  private timeoutMs = 300000;
  private maxAttempts = 2;

  constructor(
    private llmConfig?: LLMConfig,
    private specifiedModel?: string,
    private readonly httpClient: OpenAICompatibleHttpClient = HttpClient
      .getInstance(),
  ) {
  }

  async initialize(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const config = this.llmConfig;
    if (!config) {
      throw new Error("providers.ai is not configured");
    }
    this.baseURL = config.baseUrl;
    this.token = config.apiKey;
    this.timeoutMs = normalizeTimeoutMs(config.timeoutMs);
    this.maxAttempts = normalizeMaxAttempts(config.maxAttempts);

    // 获取模型配置，支持多模型格式 "model1|model2|model3"
    const modelConfig = config.model || "gpt-3.5-turbo";
    this.availableModels = modelConfig.split("|").map((model) => model.trim());

    // 如果指定了特定模型，使用指定的模型，否则使用第一个可用模型
    this.defaultModel = this.specifiedModel || this.availableModels[0];

    if (!this.baseURL) {
      throw new Error("providers.ai.baseUrl is not set");
    }
    if (!this.token) {
      throw new Error("providers.ai.apiKey is not set");
    }

    // 不在初始化阶段做网络健康检查。部分模型网关不支持 HEAD，
    // Cloudflare Workflow 也不适合在进入业务 step 前等待外部探测。
  }

  /**
   * 设置使用的模型
   * @param model 模型名称
   */
  public setModel(model: string): void {
    if (this.availableModels.includes(model)) {
      this.defaultModel = model;
    } else {
      console.warn(
        `警告: 模型 ${model} 不在可用模型列表中，将使用默认模型 ${this.defaultModel}`,
      );
    }
  }

  /**
   * 获取当前使用的模型
   * @returns 当前模型名称
   */
  public getModel(): string {
    return this.defaultModel;
  }

  /**
   * 获取所有可用的模型
   * @returns 可用模型列表
   */
  public getAvailableModels(): string[] {
    return [...this.availableModels];
  }

  async createChatCompletion(
    messages: ChatMessage[],
    options: ChatCompletionOptions = {},
  ): Promise<ChatCompletionResponse> {
    try {
      // 使用HttpClient进行请求，自动处理重试和超时
      const response = await this.httpClient.request<ChatCompletionResponse>(
        `${this.baseURL}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.token}`,
          },
          body: JSON.stringify({
            model: options.model || this.defaultModel,
            messages,
            temperature: options.temperature ?? 0.7,
            top_p: options.top_p ?? 1,
            max_tokens: options.max_tokens ?? 2000,
            stream: options.stream ?? false,
            response_format: options.response_format,
          }),
          timeout: resolveRequestTimeoutMs(options.timeoutMs, this.timeoutMs),
          retries: resolveRequestMaxAttempts(
            options.maxAttempts,
            this.maxAttempts,
          ),
          retryDelay: 1000, // 重试间隔1秒
        },
      );
      return normalizeLLMResponse(response);
    } catch (error) {
      throw toOpenAICompatibleProviderError(error);
    }
  }
}

function toOpenAICompatibleProviderError(error: unknown): ProviderError {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = `创建聊天完成失败: ${redactSensitiveText(rawMessage)}`;

  if (error instanceof TimeoutError) {
    return new ProviderError({
      provider: "openai-compatible",
      kind: "timeout",
      message,
      cause: error,
    });
  }

  if (error instanceof NetworkError) {
    return new ProviderError({
      provider: "openai-compatible",
      kind: "network",
      message,
      cause: error,
    });
  }

  if (error instanceof HttpError && error.statusCode !== undefined) {
    return classifyHttpProviderError(
      "openai-compatible",
      error.statusCode,
      message,
    );
  }

  return new ProviderError({
    provider: "openai-compatible",
    kind: "invalid_response",
    message,
    cause: error,
  });
}

function normalizeTimeoutMs(value?: number): number {
  const timeout = Number(value);
  if (!Number.isFinite(timeout)) {
    return 300000;
  }
  return Math.max(30000, Math.min(Math.floor(timeout), 600000));
}

function normalizeMaxAttempts(value?: number): number {
  const attempts = Number(value);
  if (!Number.isFinite(attempts)) {
    return 2;
  }
  return Math.max(1, Math.min(Math.floor(attempts), 5));
}

function resolveRequestTimeoutMs(
  optionTimeoutMs: number | undefined,
  providerTimeoutMs: number,
): number {
  if (optionTimeoutMs === undefined) return providerTimeoutMs;
  return Math.min(normalizeTimeoutMs(optionTimeoutMs), providerTimeoutMs);
}

function resolveRequestMaxAttempts(
  optionMaxAttempts: number | undefined,
  providerMaxAttempts: number,
): number {
  if (optionMaxAttempts === undefined) return providerMaxAttempts;
  return Math.min(normalizeMaxAttempts(optionMaxAttempts), providerMaxAttempts);
}
