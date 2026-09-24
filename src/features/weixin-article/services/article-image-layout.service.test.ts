import { assertEquals } from "@std/assert";
import {
  PexelsArticleImageLayoutService,
  WeixinArticleImageLayoutService,
} from "./article-image-layout.service.ts";
import { WeixinTemplate } from "@src/features/weixin-article/domain/renderable-article.ts";
import type { StockPhoto } from "@src/core/ports/stock-photo-search.ts";

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

Deno.test("image layout uses one source image after the first paragraph", async () => {
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
    "第一段<next_paragraph />" +
      '<img src="https://example.com/1.jpg" alt="文章配图" />' +
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
    '正文<next_paragraph /><img src="https://example.com/a&quot;b.jpg" alt="文章配图" />',
  );
});

Deno.test("image layout assigns different source images across article sections", async () => {
  const service = new WeixinArticleImageLayoutService();
  const media = ["1", "2", "3"].map((id) => ({
    url: `https://example.com/${id}.jpg`,
    type: "image" as const,
    size: { width: 100, height: 100 },
  }));

  const output = await service.layoutArticles([
    article({ id: "1", media }),
    article({ id: "2", media }),
    article({ id: "3", media }),
  ]);

  assertEquals(
    output.map((item) => item.content.match(/src="([^"]+)"/)?.[1]),
    [
      "https://example.com/1.jpg",
      "https://example.com/2.jpg",
      "https://example.com/3.jpg",
    ],
  );
});

Deno.test("Pexels image layout is disabled by default config", async () => {
  const fallback = new WeixinArticleImageLayoutService();
  const service = new PexelsArticleImageLayoutService(
    fallback,
    fakePhotoSearch(),
    { enabled: false },
  );

  const output = await service.layoutArticle(article());

  assertEquals(output.content, article().content);
});

Deno.test("Pexels image layout searches a related photo when source has no image", async () => {
  const queries: string[] = [];
  const service = new PexelsArticleImageLayoutService(
    new WeixinArticleImageLayoutService(),
    fakePhotoSearch([pexelsPhoto()], (query) => queries.push(query)),
    { enabled: true },
  );

  const output = await service.layoutArticle(article({
    title: "美国零售消费出现新变化",
    content: "第一段<next_paragraph />第二段",
  }));

  assertEquals(
    output.content,
    '第一段<next_paragraph /><img src="https://images.pexels.com/photo.jpg" alt="美国零售消费出现新变化相关配图" />' +
      '<p style="margin:6px 0 18px;color:#999999;font-size:11px;line-height:1.6;text-align:center;">图片：<a href="https://www.pexels.com/@author">摄影师</a> / <a href="https://www.pexels.com/photo/1">Pexels</a></p>' +
      "<next_paragraph />第二段",
  );
  assertEquals(queries, ["美国零售消费出现新变化"]);
});

Deno.test("Pexels image layout only searches when no unused source image remains", async () => {
  let searched = 0;
  const service = new PexelsArticleImageLayoutService(
    new WeixinArticleImageLayoutService(),
    fakePhotoSearch([pexelsPhoto()], () => searched++),
    { enabled: true },
  );
  const sharedMedia = [{
    url: "https://example.com/source.jpg",
    type: "image" as const,
    size: { width: 100, height: 100 },
  }];

  const output = await service.layoutArticles([
    article({ id: "source", media: sharedMedia }),
    article({ id: "ai", media: sharedMedia }),
  ]);

  assertEquals(searched, 1);
  assertEquals(output[0].content.includes("source.jpg"), true);
  assertEquals(output[1].content.includes("images.pexels.com"), true);
});

Deno.test("Pexels image layout never inserts the same stock image twice", async () => {
  const service = new PexelsArticleImageLayoutService(
    new WeixinArticleImageLayoutService(),
    fakePhotoSearch([pexelsPhoto()]),
    { enabled: true },
  );

  const output = await service.layoutArticles([
    article({ id: "first", title: "同一主题" }),
    article({ id: "second", title: "同一主题" }),
  ]);

  assertEquals(output[0].content.includes("images.pexels.com"), true);
  assertEquals(output[1].content.includes("<img"), false);
});

Deno.test("Pexels image layout skips the image when search fails", async () => {
  const service = new PexelsArticleImageLayoutService(
    new WeixinArticleImageLayoutService(),
    {
      search: () => Promise.reject(new Error("boom")),
    },
    { enabled: true },
  );

  const input = article({ content: "正文" });
  const output = await service.layoutArticle(input);

  assertEquals(output, input);
});

function pexelsPhoto(overrides: Partial<StockPhoto> = {}): StockPhoto {
  return {
    id: "1",
    imageUrl: "https://images.pexels.com/photo.jpg",
    pageUrl: "https://www.pexels.com/photo/1",
    photographer: "摄影师",
    photographerUrl: "https://www.pexels.com/@author",
    width: 1200,
    height: 627,
    ...overrides,
  };
}

function fakePhotoSearch(
  photos: StockPhoto[] = [],
  onSearch?: (query: string) => void,
) {
  return {
    search: ({ query }: { query: string }) => {
      onSearch?.(query);
      return Promise.resolve(photos);
    },
  };
}
