import { assertEquals } from "@std/assert";
import {
  AiArticleImageLayoutService,
  WeixinArticleImageLayoutService,
} from "./article-image-layout.service.ts";
import { WeixinTemplate } from "@src/features/weixin-article/domain/renderable-article.ts";

function article(overrides: Partial<WeixinTemplate> = {}): WeixinTemplate {
  return {
    id: "1",
    title: "标题",
    content: "第一段<next_paragraph />第二段<next_paragraph />第三段",
    url: "https://example.com",
    publishDate: "2026-05-21",
    metadata: {},
    keywords: [],
    ...overrides,
  };
}

Deno.test("image layout keeps article unchanged when no media exists", async () => {
  const service = new WeixinArticleImageLayoutService();
  const input = article();

  assertEquals(await service.layoutArticle(input), input);
});

Deno.test("image layout places first image at top and then between paragraphs", async () => {
  const service = new WeixinArticleImageLayoutService();
  const output = await service.layoutArticle(article({
    media: [
      {
        url: "https://example.com/1.jpg",
        type: "image",
        size: { width: 100, height: 100 },
      },
      {
        url: "https://example.com/2.jpg",
        type: "image",
        size: { width: 100, height: 100 },
      },
    ],
  }));

  assertEquals(
    output.content,
    '<img src="https://example.com/1.jpg" alt="文章配图" />' +
      "<next_paragraph />第一段<next_paragraph />" +
      '<img src="https://example.com/2.jpg" alt="文章配图" />' +
      "<next_paragraph />第二段<next_paragraph />第三段",
  );
});

Deno.test("image layout escapes image URLs and ignores duplicates", async () => {
  const service = new WeixinArticleImageLayoutService();
  const output = await service.layoutArticle(article({
    content: "正文",
    media: [
      {
        url: 'https://example.com/a"b.jpg',
        type: "image",
        size: { width: 100, height: 100 },
      },
      {
        url: 'https://example.com/a"b.jpg',
        type: "image",
        size: { width: 100, height: 100 },
      },
    ],
  }));

  assertEquals(
    output.content,
    '<img src="https://example.com/a&quot;b.jpg" alt="文章配图" /><next_paragraph />正文',
  );
});

Deno.test("AI image layout is disabled by default config", async () => {
  const fallback = new WeixinArticleImageLayoutService();
  const service = new AiArticleImageLayoutService(
    fallback,
    fakeImageGeneratorResolver("https://example.com/ai.jpg"),
    { enabled: false },
  );

  const output = await service.layoutArticle(article());

  assertEquals(output.content, article().content);
});

Deno.test("AI image layout generates image when enabled", async () => {
  const service = new AiArticleImageLayoutService(
    new WeixinArticleImageLayoutService(),
    fakeImageGeneratorResolver("https://example.com/ai.jpg"),
    {
      enabled: true,
      imageCount: 1,
      imageSize: "1024*1024",
      onlyWhenNoMedia: true,
    },
  );

  const output = await service.layoutArticle(article({
    content: "第一段<next_paragraph />第二段",
  }));

  assertEquals(
    output.content,
    '<img src="https://example.com/ai.jpg" alt="文章配图" /><next_paragraph />第一段<next_paragraph />第二段',
  );
});

Deno.test("AI image layout falls back to existing media on generation failure", async () => {
  const service = new AiArticleImageLayoutService(
    new WeixinArticleImageLayoutService(),
    {
      getGenerator: () =>
        Promise.resolve({
          generate: () => Promise.reject(new Error("boom")),
        }),
    },
    { enabled: true, imageCount: 1 },
  );

  const output = await service.layoutArticle(article({
    content: "正文",
    media: [{
      url: "https://example.com/source.jpg",
      type: "image",
      size: { width: 100, height: 100 },
    }],
  }));

  assertEquals(
    output.content,
    '<img src="https://example.com/source.jpg" alt="文章配图" /><next_paragraph />正文',
  );
});

function fakeImageGeneratorResolver(url: string) {
  return {
    getGenerator: () =>
      Promise.resolve({
        generate: () => Promise.resolve(url),
      }),
  };
}
