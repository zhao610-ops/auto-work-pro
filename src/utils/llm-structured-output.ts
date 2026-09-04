import type {
  ChatCompletionOptions,
  ChatMessage,
  LLMProvider,
} from "@src/core/ports/llm.ts";
import { ProviderError } from "@src/core/errors/provider-error.ts";
import { parseLLMJson } from "@src/utils/llm-output.ts";
import { Logger } from "@zilla/logger";

const logger = new Logger("llm-structured-output");

export interface StructuredJsonCompletionOptions<TRaw, TResult> {
  label: string;
  llm: LLMProvider;
  messages: ChatMessage[];
  chatOptions?: ChatCompletionOptions;
  normalize: (raw: TRaw) => TResult;
  maxAttempts?: number;
  baseDelayMs?: number;
}

export async function createStructuredJsonCompletion<TRaw, TResult>(
  options: StructuredJsonCompletionOptions<TRaw, TResult>,
): Promise<TResult> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 2));
  const baseDelayMs = Math.max(0, Math.floor(options.baseDelayMs ?? 800));
  let messages = [...options.messages];
  let lastError: Error | undefined;
  let lastOutput = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await options.llm.createChatCompletion(messages, {
        ...options.chatOptions,
        response_format: options.chatOptions?.response_format ??
          { type: "json_object" },
      });
      const text = response.choices[0]?.message?.content;
      if (!text) {
        throw new Error(`未获取到有效的${options.label}结果`);
      }
      lastOutput = text;
      const raw = parseLLMJson<TRaw>(text);
      if (!isPlainObject(raw)) {
        throw new Error(`${options.label}必须返回 JSON 对象`);
      }
      return options.normalize(raw);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (isNonCorrectableProviderError(lastError)) {
        logger.warn(
          `[${options.label}] LLM 调用失败，停止结构纠偏并交给业务兜底: ${lastError.message}`,
        );
        break;
      }
      if (attempt >= maxAttempts) {
        break;
      }
      logger.warn(
        `[${options.label}] 结构化输出解析/校验失败，准备纠偏重试 (${attempt}/${maxAttempts}): ${lastError.message}`,
      );
      messages = createCorrectionMessages(
        options.messages,
        lastOutput,
        lastError.message,
      );
      if (baseDelayMs > 0) {
        await delay(baseDelayMs * attempt);
      }
    }
  }

  throw lastError ?? new Error(`${options.label}结构化输出失败`);
}

function isNonCorrectableProviderError(error: Error): boolean {
  if (!(error instanceof ProviderError)) return false;
  return error.kind === "auth" ||
    error.kind === "quota" ||
    error.kind === "rate_limit" ||
    error.kind === "network" ||
    error.kind === "timeout";
}

function createCorrectionMessages(
  originalMessages: ChatMessage[],
  badOutput: string,
  errorMessage: string,
): ChatMessage[] {
  return [
    ...originalMessages,
    {
      role: "assistant",
      content: truncateForCorrection(badOutput || "（空输出）"),
    },
    {
      role: "user",
      content:
        `上一次输出无法解析或未通过结构校验。\n错误：${errorMessage}\n\n请基于同一任务重新输出一个完整、合法的 JSON 对象。不要输出 Markdown、代码围栏、解释、推理过程或 <think>。`,
    },
  ];
}

function truncateForCorrection(value: string): string {
  const maxLength = 2400;
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPlainObject(value: unknown): boolean {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
