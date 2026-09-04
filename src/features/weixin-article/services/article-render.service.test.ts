import { assertEquals } from "@std/assert";
import { WeixinArticleRenderService } from "@src/features/weixin-article/services/article-render.service.ts";
import type { ArticlePlan } from "@src/features/weixin-article/domain/article-plan.ts";

Deno.test("toTemplateData converts scraped content into renderable article model", () => {
  const service = new WeixinArticleRenderService(fakeRenderer());

  const result = service.toTemplateData([{
    id: "raw-1",
    title: "AI 新闻",
    content: "正文",
    url: "https://example.com",
    publishDate: "2026-05-21",
    metadata: {
      keywords: ["AI", "模型"],
      source: "test",
    },
    media: [{
      type: "image",
      url: "https://example.com/image.png",
      size: { width: 1200, height: 675 },
    }],
  }]);

  assertEquals(result, [{
    id: "raw-1",
    title: "AI 新闻",
    content: "正文",
    url: "https://example.com",
    publishDate: "2026-05-21",
    metadata: {
      keywords: ["AI", "模型"],
      source: "test",
    },
    keywords: ["AI", "模型"],
    media: [{
      type: "image",
      url: "https://example.com/image.png",
      size: { width: 1200, height: 675 },
    }],
  }]);
});

Deno.test("toTemplateData falls back to empty keywords when metadata is not an array", () => {
  const service = new WeixinArticleRenderService(fakeRenderer());

  const result = service.toTemplateData([{
    id: "raw-2",
    title: "AI 新闻",
    content: "正文",
    url: "https://example.com",
    publishDate: "2026-05-21",
    metadata: { keywords: "AI" },
  }]);

  assertEquals(result[0].keywords, []);
});

Deno.test("toTemplateData renders planned sections for brief formats too", () => {
  const service = new WeixinArticleRenderService(fakeRenderer());
  const result = service.toTemplateData(
    [
      content("unrelated", "无关资讯"),
      content("lead", "主线文章"),
      content("support", "补充文章"),
    ],
    {
      format: "daily-brief",
      thesis: "主线观点",
      targetReader: "读者",
      summary: "摘要",
      sections: [
        {
          id: "section-1",
          title: "主线",
          intent: "先讲主线",
          angle: "主线角度",
          articleIds: ["lead", "support", "lead"],
          keyPoints: [],
        },
      ],
      titleDirections: [],
      coverDirection: {
        visualBrief: "封面",
        textBrief: "封面文案",
        mood: "克制",
      },
      bodyImagePlan: {
        enabled: false,
        placements: [],
      },
      riskNotes: [],
    } satisfies ArticlePlan,
  );

  assertEquals(result.map((item) => item.id), ["section-1"]);
  assertEquals(result[0].title, "主线");
  assertEquals(result[0].metadata.sourceArticleIds, [
    "lead",
    "support",
    "lead",
  ]);
  assertEquals(result[0].content.includes("可引用来源要点：主线文章"), true);
});

Deno.test("toTemplateData renders planned sections for analysis formats", () => {
  const service = new WeixinArticleRenderService(fakeRenderer());
  const result = service.toTemplateData(
    [
      content("lead", "来源文章"),
    ],
    {
      format: "product-review",
      thesis: "主线观点",
      targetReader: "读者",
      summary: "摘要",
      sections: [
        {
          id: "section-1",
          title: "工程规格",
          intent: "解释工程规格",
          angle: "按计划章节展开",
          articleIds: ["lead"],
          keyPoints: ["必须说明限制", "避免只复述新闻稿"],
        },
        {
          id: "section-2",
          title: "落地边界",
          intent: "说明边界",
          angle: "给出使用判断",
          articleIds: ["lead"],
          keyPoints: ["适用场景", "不适用场景"],
        },
      ],
      titleDirections: [],
      coverDirection: {
        visualBrief: "封面",
        textBrief: "封面文案",
        mood: "克制",
      },
      bodyImagePlan: {
        enabled: false,
        placements: [],
      },
      riskNotes: [],
      generatedAt: "2026-05-24T00:00:00.000Z",
      fallback: false,
      sourceArticleIds: ["lead"],
    } satisfies ArticlePlan,
  );

  assertEquals(result.map((item) => item.id), ["section-1", "section-2"]);
  assertEquals(result[0].title, "工程规格");
  assertEquals(result[0].metadata.articlePlanFormat, "product-review");
  assertEquals(result[0].content.includes("必须说明限制"), true);
});

function content(id: string, title: string) {
  return {
    id,
    title,
    content: `${title} 正文`,
    url: `https://example.com/${id}`,
    publishDate: "2026-05-24",
    metadata: {},
  };
}

function fakeRenderer() {
  return {
    setUploadContentImages: () => {},
    render: () => Promise.resolve(""),
  };
}
