import { assertEquals, assertRejects } from "@std/assert";
import { HttpClient } from "@src/utils/http/http-client.ts";
import {
  MINIMAX_DEFAULT_IMAGE_MODEL,
  MiniMaxImageGenerator,
} from "@src/integrations/image/providers/minimax/minimax-image-generator.ts";

Deno.test("MiniMaxImageGenerator posts image generation request", async () => {
  let capturedUrl = "";
  let capturedBody: Record<string, unknown> = {};
  const httpClient = {
    request: async <T>(url: string, options: RequestInit): Promise<T> => {
      capturedUrl = url;
      capturedBody = JSON.parse(String(options.body));
      return {
        data: {
          image_urls: ["https://example.com/minimax-image.png"],
        },
        base_resp: { status_code: 0 },
      } as T;
    },
  } as unknown as HttpClient;

  const generator = new MiniMaxImageGenerator(
    "minimax-key",
    "https://api.minimax.io/",
    httpClient,
  );
  await generator.initialize();
  const imageUrl = await generator.generate({
    prompt: "一张公众号正文配图",
    model: "image-01",
    size: "1024*1024",
    n: 2,
  });

  assertEquals(capturedUrl, "https://api.minimax.io/v1/image_generation");
  assertEquals(capturedBody.model, "image-01");
  assertEquals(capturedBody.prompt, "一张公众号正文配图");
  assertEquals(capturedBody.aspect_ratio, "1:1");
  assertEquals(capturedBody.n, 2);
  assertEquals(imageUrl, "https://example.com/minimax-image.png");
});

Deno.test("MiniMaxImageGenerator falls back from DashScope model ids", async () => {
  let capturedBody: Record<string, unknown> = {};
  const httpClient = {
    request: async <T>(_url: string, options: RequestInit): Promise<T> => {
      capturedBody = JSON.parse(String(options.body));
      return {
        data: {
          image_base64: ["abc"],
        },
        base_resp: { status_code: 0 },
      } as T;
    },
  } as unknown as HttpClient;

  const generator = new MiniMaxImageGenerator(
    "minimax-key",
    undefined,
    httpClient,
  );
  await generator.initialize();
  const image = await generator.generate({
    title: "标题",
    prompt_text_zh: "专业配图",
    model: "qwen-image-2.0-pro",
  });

  assertEquals(capturedBody.model, MINIMAX_DEFAULT_IMAGE_MODEL);
  assertEquals(image, "data:image/jpeg;base64,abc");
});

Deno.test("MiniMaxImageGenerator requires api key", async () => {
  const generator = new MiniMaxImageGenerator("");
  await assertRejects(
    () => generator.initialize(),
    Error,
    "providers.image.minimax.apiKey is not set",
  );
});
