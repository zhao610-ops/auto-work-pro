import { assertEquals } from "@std/assert";
import type { LLMProvider } from "@src/core/ports/llm.ts";
import type { ArticlePlan } from "@src/features/weixin-article/domain/article-plan.ts";
import type { WeixinTemplate } from "@src/features/weixin-article/domain/renderable-article.ts";
import {
  shouldDraft,
  WeixinArticleDraftService,
} from "@src/features/weixin-article/services/article-draft.service.ts";

Deno.test("article draft service rewrites planned sections into reader prose", async () => {
  let calls = 0;
  const service = new WeixinArticleDraftService(createLlm(() => {
    calls++;
    return JSON.stringify({
      articles: [{
        id: "section-1",
        title: "为什么这件事值得开发者看",
        content:
          "这次变化首先影响的是开发者对工具链的选择。官方信息显示，相关能力仍处在逐步展开阶段，因此不能直接推导出完整 API 或价格。<next_paragraph />更实际的判断是，它把协作式研究和工程自动化重新放到同一个问题里：哪些环节适合交给模型，哪些环节仍需要团队保留审核权。",
      }],
    });
  }));

  const result = await service.draftTemplateData(
    [template("section-1")],
    plan({
      format: "deep-analysis",
    }),
  );

  assertEquals(calls, 1);
  assertEquals(result[0].title, "为什么这件事值得开发者看");
  assertEquals(result[0].content.includes("本段要说明"), false);
  assertEquals(result[0].content.includes("开发者对工具链的选择"), true);
});

Deno.test("article draft service keeps unmatched sections as fallback", async () => {
  const service = new WeixinArticleDraftService(createLlm(() =>
    JSON.stringify({
      articles: [{
        id: "missing",
        title: "不存在",
        content: "不会被应用",
      }],
    })
  ));

  const source = [template("section-1")];
  const result = await service.draftTemplateData(
    source,
    plan({
      format: "trend-analysis",
    }),
  );

  assertEquals(result, source);
});

Deno.test("article draft service sanitizes internal labels for unmatched sections", async () => {
  const service = new WeixinArticleDraftService(createLlm(() =>
    JSON.stringify({
      articles: [{
        id: "missing",
        title: "不存在",
        content: "不会被应用",
      }],
    })
  ));

  const result = await service.draftTemplateData([{
    ...template("section-1"),
    content:
      "章节目标（仅作编辑目标，不是事实来源）：说明背景<next_paragraph />待核对编辑要点（必须由来源支持后才能写入正文）：不要直接发布<next_paragraph />可引用来源要点：官方确认 Claude Opus 4.8 改进长任务一致性。",
    metadata: {
      sourceExcerptText:
        "Anthropic News\nClaude Opus 4.8 improves coding and long-running work consistency.",
    },
  }], plan({ format: "product-review" }));

  assertEquals(result[0].content.includes("章节目标"), false);
  assertEquals(result[0].content.includes("待核对编辑要点"), false);
  assertEquals(result[0].content.includes("Claude Opus 4.8"), true);
});

Deno.test("article draft service sanitizes internal labels in model output", async () => {
  const service = new WeixinArticleDraftService(createLlm(() =>
    JSON.stringify({
      articles: [{
        id: "section-1",
        title: "可读章节",
        content:
          "章节目标（仅作编辑目标，不是事实来源）：说明背景<next_paragraph />写作角度（仅作编辑目标，不是事实来源）：从工程团队看<next_paragraph />可引用来源要点：官方确认 Claude Opus 4.8 改进长任务一致性。",
      }],
    })
  ));

  const result = await service.draftTemplateData([{
    ...template("section-1"),
    metadata: {
      sourceExcerptText:
        "Anthropic News\nClaude Opus 4.8 improves coding and long-running work consistency.",
    },
  }], plan({ format: "product-review" }));

  assertEquals(result[0].content.includes("章节目标"), false);
  assertEquals(result[0].content.includes("写作角度"), false);
  assertEquals(result[0].content.includes("可引用来源要点"), false);
  assertEquals(result[0].content.includes("Claude Opus 4.8"), true);
});

Deno.test("article draft service drops paragraphs with unsupported key entities", async () => {
  const service = new WeixinArticleDraftService(createLlm(() =>
    JSON.stringify({
      articles: [{
        id: "section-1",
        title: "Meta 新方向还缺工程规格",
        content:
          "Meta Muse Spark 目前只有定位标签，官方暂未披露参数、API 或开源状态。<next_paragraph />OpenAI Codex 和税务 Agent 也在同一时期推进场景化 Agent，这能作为对比参照。",
      }],
    })
  ));

  const result = await service.draftTemplateData([{
    ...template("section-1"),
    metadata: {
      sourceExcerptText:
        "Meta AI Blog\nIntroducing Muse Spark: Scaling Towards Personal Superintelligence.",
    },
  }], plan({ format: "mixed" }));

  assertEquals(result[0].content.includes("Meta Muse Spark"), true);
  assertEquals(result[0].content.includes("OpenAI Codex"), false);
});

Deno.test("article draft service removes unsupported parameter sentences", async () => {
  const service = new WeixinArticleDraftService(createLlm(() =>
    JSON.stringify({
      articles: [{
        id: "section-1",
        title: "Opus 4.8 选型",
        content:
          "Claude Opus 4.8 明确提升长任务稳定性。<next_paragraph />如果它维持 Opus 4.7 的 200K token 水平，就适合大上下文迁移；否则建议等待文档。",
      }],
    })
  ));

  const result = await service.draftTemplateData([{
    ...template("section-1"),
    metadata: {
      sourceExcerptText:
        "Anthropic News\nClaude Opus 4.8 improves coding, agentic tasks and long-running work consistency. Context window is not disclosed.",
    },
  }], plan({ format: "product-review" }));

  assertEquals(result[0].content.includes("Claude Opus 4.8"), true);
  assertEquals(result[0].content.includes("Opus 4.7"), false);
  assertEquals(result[0].content.includes("200K"), false);
});

Deno.test("article draft service also drafts brief formats", async () => {
  let calls = 0;
  const service = new WeixinArticleDraftService(createLlm(() => {
    calls++;
    return JSON.stringify({
      articles: [{
        id: "section-1",
        title: "简报主线",
        content: "这是一段经过起草的简报正文。",
      }],
    });
  }));

  const result = await service.draftTemplateData(
    [template("section-1")],
    plan({
      format: "daily-brief",
    }),
  );

  assertEquals(calls, 1);
  assertEquals(result[0].title, "简报主线");
  assertEquals(result[0].content, "这是一段经过起草的简报正文。");
  assertEquals(shouldDraft(plan({ format: "daily-brief" })), true);
  assertEquals(shouldDraft(plan({ format: "mixed" })), true);
  assertEquals(shouldDraft(plan({ format: "product-review" })), true);
});

Deno.test("article draft service sanitizes fallback when LLM fails", async () => {
  const service = new WeixinArticleDraftService({
    initialize: () => Promise.resolve(),
    refresh: () => Promise.resolve(),
    setModel: () => {},
    createChatCompletion: () => Promise.reject(new Error("network down")),
  });

  const result = await service.draftTemplateData([{
    ...template("section-1"),
    content:
      "章节目标（仅作编辑目标，不是事实来源）：说明背景<next_paragraph />待核对编辑要点（必须由来源支持后才能写入正文）：不要直接发布<next_paragraph />可引用来源要点：官方确认 Claude Opus 4.8 改进长任务一致性。",
    metadata: {
      sourceExcerptText:
        "Anthropic News\nClaude Opus 4.8 improves coding and long-running work consistency.",
    },
  }], plan({ format: "daily-brief" }));

  assertEquals(result[0].content.includes("章节目标"), false);
  assertEquals(result[0].content.includes("待核对编辑要点"), false);
  assertEquals(result[0].content.includes("Claude Opus 4.8"), true);
});

function createLlm(content: () => string): LLMProvider {
  return {
    initialize: () => Promise.resolve(),
    refresh: () => Promise.resolve(),
    setModel: () => {},
    createChatCompletion: () =>
      Promise.resolve({ choices: [{ message: { content: content() } }] }),
  };
}

function template(id: string): WeixinTemplate {
  return {
    id,
    title: "计划章节",
    content:
      "意图：本段要说明工程影响。\n角度：从团队采用成本看。\n要点：避免编造价格。\n来源：官方暂未披露完整 API。",
    url: "https://example.com/source",
    publishDate: "2026-05-24",
    metadata: {
      sourceUrls: ["https://example.com/source"],
      sourceArticleIds: ["source-1"],
    },
    keywords: [],
  };
}

function plan(
  overrides: Partial<ArticlePlan> = {},
): ArticlePlan {
  return {
    generatedAt: "2026-05-24T00:00:00.000Z",
    fallback: false,
    format: "deep-analysis",
    thesis: "开发者工具链正在变化。",
    targetReader: "工程团队负责人",
    summary: "解释变化、边界和团队决策。",
    sections: [{
      id: "section-1",
      title: "工程影响",
      intent: "说明工程影响",
      angle: "从团队采用成本看",
      articleIds: ["source-1"],
      keyPoints: ["避免编造价格", "保留审核权"],
    }],
    titleDirections: [],
    coverDirection: {
      visualBrief: "工程控制台",
      textBrief: "开发者工具链",
      mood: "克制",
    },
    bodyImagePlan: {
      enabled: false,
      placements: [],
    },
    riskNotes: [],
    sourceArticleIds: ["source-1"],
    ...overrides,
  };
}
