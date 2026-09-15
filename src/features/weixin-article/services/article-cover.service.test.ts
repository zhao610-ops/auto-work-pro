import { assertEquals } from "@std/assert";
import { ImageGeneratorType } from "@src/core/ports/image-generator.ts";
import {
  DEFAULT_COVER_IMAGE_SIZE,
  DEFAULT_COVER_MEDIA_ID,
  WeixinArticleCoverService,
} from "@src/features/weixin-article/services/article-cover.service.ts";

Deno.test("cover service records generated cover details", async () => {
  const uploaded: string[] = [];
  let request: Record<string, unknown> | undefined;
  const service = new WeixinArticleCoverService(
    {
      uploadImage: async (url: string) => {
        uploaded.push(url);
        return "media-generated";
      },
    },
    {
      getGenerator: async () => ({
        initialize: async () => {},
        refresh: async () => {},
        saveToFile: async () => {},
        generate: (options) => {
          request = options as unknown as Record<string, unknown>;
          return Promise.resolve("https://example.com/cover.png");
        },
      }),
    },
    "technology",
    "qwen-image-2.0-pro",
    ImageGeneratorType.ALIYUN_POSTER,
  );

  const result = await service.generateCover("AI速递 | 新模型发布");

  assertEquals(result.mediaId, "media-generated");
  assertEquals(result.generated, true);
  assertEquals(result.fallback, false);
  assertEquals(result.model, "qwen-image-2.0-pro");
  assertEquals(result.imageUrl, "https://example.com/cover.png");
  assertEquals(uploaded, ["https://example.com/cover.png"]);
  assertEquals(request?.size, DEFAULT_COVER_IMAGE_SIZE);
  assertEquals(request?.sub_title, undefined);
  assertEquals(
    String(request?.prompt_text_zh).includes("画面中不得出现任何中文"),
    true,
  );
});

Deno.test("cover service records fallback reason", async () => {
  const uploaded: string[] = [];
  const service = new WeixinArticleCoverService(
    {
      uploadImage: async (url: string) => {
        uploaded.push(url);
        return "media-default";
      },
    },
    {
      getGenerator: async () => ({
        initialize: async () => {},
        refresh: async () => {},
        saveToFile: async () => {},
        generate: async () => {
          throw new Error("task failed");
        },
      }),
    },
    "technology",
    "qwen-image-2.0-pro",
    ImageGeneratorType.ALIYUN_POSTER,
  );

  const result = await service.generateCover("AI速递 | 新模型发布");

  assertEquals(result.mediaId, DEFAULT_COVER_MEDIA_ID);
  assertEquals(result.generated, false);
  assertEquals(result.fallback, true);
  assertEquals(result.error, "task failed");
  assertEquals(uploaded, []);
});

Deno.test("cover service prefers a qualified source image", async () => {
  const uploaded: string[] = [];
  const service = new WeixinArticleCoverService(
    {
      uploadImage: async (url: string) => (uploaded.push(url), "source-media"),
    },
    {
      getGenerator: async () => ({
        initialize: async () => {},
        refresh: async () => {},
        saveToFile: async () => {},
        generate: async () => "https://example.com/ai.png",
      }),
    },
  );

  const result = await service.generateCover("菜价变化", {
    sourceImages: [{
      url: "https://images.example.com/market.jpg",
      width: 1600,
      height: 900,
      sourceArticleUrl: "https://news.example.com/article",
    }],
  });

  assertEquals(result.strategy, "source-image");
  assertEquals(result.generated, false);
  assertEquals(result.imageUrl, "https://images.example.com/market.jpg");
  assertEquals(uploaded, ["https://images.example.com/market.jpg"]);
});

Deno.test("cover service falls back to AI when source image is unsuitable", async () => {
  const uploaded: string[] = [];
  const service = new WeixinArticleCoverService(
    { uploadImage: async (url: string) => (uploaded.push(url), "ai-media") },
    {
      getGenerator: async () => ({
        initialize: async () => {},
        refresh: async () => {},
        saveToFile: async () => {},
        generate: async () => "https://example.com/ai.png",
      }),
    },
  );

  const result = await service.generateCover("菜价变化", {
    sourceImages: [{ url: "https://images.example.com/logo.png" }],
  });

  assertEquals(result.strategy, "ai-generated");
  assertEquals(result.generated, true);
  assertEquals(uploaded, ["https://example.com/ai.png"]);
});

Deno.test("cover service falls back when image generation hangs", async () => {
  const uploaded: string[] = [];
  const service = new WeixinArticleCoverService(
    {
      uploadImage: async (url: string) => {
        uploaded.push(url);
        return "media-default";
      },
    },
    {
      getGenerator: async () => ({
        initialize: async () => {},
        refresh: async () => {},
        saveToFile: async () => {},
        generate: () => new Promise<string>(() => {}),
      }),
    },
    "technology",
    "qwen-image-2.0-pro",
    ImageGeneratorType.ALIYUN_POSTER,
    undefined,
    {
      generationMs: 5,
    },
  );

  const result = await service.generateCover("AI速递 | 新模型发布");

  assertEquals(result.mediaId, DEFAULT_COVER_MEDIA_ID);
  assertEquals(result.generated, false);
  assertEquals(result.fallback, true);
  assertEquals(result.error, "封面图片生成超时");
  assertEquals(uploaded, []);
});
