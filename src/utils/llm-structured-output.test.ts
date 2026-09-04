import { assertEquals, assertRejects } from "@std/assert";
import { ProviderError } from "@src/core/errors/provider-error.ts";
import type {
  ChatCompletionOptions,
  ChatCompletionResponse,
  ChatMessage,
  LLMProvider,
} from "@src/core/ports/llm.ts";
import { createStructuredJsonCompletion } from "@src/utils/llm-structured-output.ts";

Deno.test("createStructuredJsonCompletion retries with correction feedback", async () => {
  const llm = new FakeStructuredLlm([
    "Let me analyze first. { title: 'bad', }",
    JSON.stringify({ title: "修复后", score: 92 }),
  ]);

  const result = await createStructuredJsonCompletion<
    { title?: unknown; score?: unknown },
    { title: string; score: number }
  >({
    label: "测试结构化输出",
    llm,
    messages: [{ role: "user", content: "输出 JSON" }],
    chatOptions: { temperature: 0.2 },
    maxAttempts: 2,
    baseDelayMs: 0,
    normalize: (raw) => {
      if (typeof raw.title !== "string" || typeof raw.score !== "number") {
        throw new Error("字段不完整");
      }
      return { title: raw.title, score: raw.score };
    },
  });

  assertEquals(result, { title: "修复后", score: 92 });
  assertEquals(llm.calls.length, 2);
  assertEquals(
    llm.calls[1].messages.at(-1)?.content.includes("上一次输出无法解析"),
    true,
  );
});

Deno.test("createStructuredJsonCompletion does not correction-retry provider transport errors", async () => {
  const llm = new FailingStructuredLlm(
    new ProviderError({
      provider: "openai-compatible",
      kind: "network",
      message: "network down",
    }),
  );

  await assertRejects(
    () =>
      createStructuredJsonCompletion<
        { title?: unknown },
        { title: string }
      >({
        label: "测试结构化输出",
        llm,
        messages: [{ role: "user", content: "输出 JSON" }],
        maxAttempts: 3,
        baseDelayMs: 0,
        normalize: (raw) => {
          if (typeof raw.title !== "string") {
            throw new Error("字段不完整");
          }
          return { title: raw.title };
        },
      }),
    ProviderError,
    "network down",
  );
  assertEquals(llm.calls.length, 1);
});

class FakeStructuredLlm implements LLMProvider {
  calls: Array<{ messages: ChatMessage[]; options?: ChatCompletionOptions }> =
    [];

  constructor(private readonly outputs: string[]) {}

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  refresh(): Promise<void> {
    return Promise.resolve();
  }

  setModel(): void {}

  createChatCompletion(
    messages: ChatMessage[],
    options?: ChatCompletionOptions,
  ): Promise<ChatCompletionResponse> {
    this.calls.push({ messages, options });
    const content = this.outputs[this.calls.length - 1] ?? this.outputs.at(-1);
    return Promise.resolve({
      choices: [{
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      }],
    });
  }
}

class FailingStructuredLlm implements LLMProvider {
  calls: Array<{ messages: ChatMessage[]; options?: ChatCompletionOptions }> =
    [];

  constructor(private readonly error: Error) {}

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  refresh(): Promise<void> {
    return Promise.resolve();
  }

  setModel(): void {}

  createChatCompletion(
    messages: ChatMessage[],
    options?: ChatCompletionOptions,
  ): Promise<ChatCompletionResponse> {
    this.calls.push({ messages, options });
    return Promise.reject(this.error);
  }
}
