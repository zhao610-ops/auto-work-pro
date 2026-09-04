import { assertEquals, assertRejects } from "@std/assert";
import { ProviderError } from "@src/core/errors/provider-error.ts";
import { OpenAICompatibleLLM } from "@src/integrations/llm/providers/openai-compatible-llm.ts";
import { NetworkError } from "@src/utils/http/http-client.ts";

Deno.test("OpenAICompatibleLLM allows per-call timeout and attempt budget", async () => {
  const httpClient = new CaptureHttpClient();
  const llm = new OpenAICompatibleLLM(
    {
      baseUrl: "https://llm.example.com/v1",
      apiKey: "test-key",
      model: "test-model",
      timeoutMs: 240_000,
      maxAttempts: 3,
    },
    undefined,
    httpClient,
  );

  await llm.initialize();
  await llm.createChatCompletion(
    [{ role: "user", content: "hello" }],
    {
      timeoutMs: 120_000,
      maxAttempts: 1,
    },
  );

  assertEquals(httpClient.lastOptions?.timeout, 120_000);
  assertEquals(httpClient.lastOptions?.retries, 1);
});

Deno.test("OpenAICompatibleLLM caps per-call budget by provider config", async () => {
  const httpClient = new CaptureHttpClient();
  const llm = new OpenAICompatibleLLM(
    {
      baseUrl: "https://llm.example.com/v1",
      apiKey: "test-key",
      model: "test-model",
      timeoutMs: 90_000,
      maxAttempts: 2,
    },
    undefined,
    httpClient,
  );

  await llm.initialize();
  await llm.createChatCompletion(
    [{ role: "user", content: "hello" }],
    {
      timeoutMs: 300_000,
      maxAttempts: 5,
    },
  );

  assertEquals(httpClient.lastOptions?.timeout, 90_000);
  assertEquals(httpClient.lastOptions?.retries, 2);
});

Deno.test("OpenAICompatibleLLM classifies network failures", async () => {
  const llm = new OpenAICompatibleLLM(
    {
      baseUrl: "https://llm.example.com/v1",
      apiKey: "test-key",
      model: "test-model",
      timeoutMs: 90_000,
      maxAttempts: 2,
    },
    undefined,
    new FailingHttpClient(
      new NetworkError(
        "https://llm.example.com/v1/chat/completions",
        new Error("tls handshake eof"),
      ),
    ),
  );

  await llm.initialize();

  const error = await assertRejects(
    () => llm.createChatCompletion([{ role: "user", content: "hello" }]),
    ProviderError,
    "tls handshake eof",
  );
  assertEquals(error.kind, "network");
});

class CaptureHttpClient {
  lastOptions?: RequestInit & {
    timeout?: number;
    retries?: number;
    retryDelay?: number;
  };

  request<T>(
    _url: string,
    options?: RequestInit & {
      timeout?: number;
      retries?: number;
      retryDelay?: number;
    },
  ): Promise<T> {
    this.lastOptions = options;
    return Promise.resolve({
      choices: [{ message: { content: "ok" } }],
    } as T);
  }
}

class FailingHttpClient {
  constructor(private readonly error: Error) {}

  request<T>(): Promise<T> {
    return Promise.reject(this.error);
  }
}
