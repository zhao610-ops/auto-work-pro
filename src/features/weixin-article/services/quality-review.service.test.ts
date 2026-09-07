import { assertEquals } from "@std/assert";
import type { LLMProvider } from "@src/core/ports/llm.ts";
import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { ArticlePlan } from "@src/features/weixin-article/domain/article-plan.ts";
import type { EditorialTopicReport } from "@src/features/weixin-article/domain/editorial-topic.ts";
import {
  normalizeQualityReview,
  WeixinArticleQualityReviewService,
} from "@src/features/weixin-article/services/quality-review.service.ts";

const contents: ScrapedContent[] = [{
  id: "a1",
  title: "OpenAI 发布新模型",
  content: "OpenAI 发布新模型，面向开发者提供更低延迟。",
  url: "https://example.com/a1",
  publishDate: "2026-05-23",
  metadata: {},
}];

const topicReport: EditorialTopicReport = {
  generatedAt: "2026-05-23T00:00:00.000Z",
  fallback: false,
  clusters: [{
    id: "topic-1",
    title: "OpenAI 模型更新",
    summary: "模型更新影响开发者。",
    keywords: ["OpenAI"],
    articleIds: ["a1"],
    primaryArticleId: "a1",
    sourceCount: 1,
    freshness: 80,
    confidence: 80,
  }],
  scores: [{
    topicId: "topic-1",
    novelty: 80,
    relevance: 80,
    impact: 75,
    evidence: 80,
    actionability: 70,
    saturation: 20,
    risk: 20,
    finalScore: 78,
    reason: "值得关注。",
    recommendedUse: "lead",
  }],
};

const articlePlan: ArticlePlan = {
  generatedAt: "2026-05-23T00:00:00.000Z",
  fallback: false,
  format: "deep-analysis",
  thesis: "模型更新影响开发者成本。",
  targetReader: "开发者",
  summary: "围绕模型更新写作。",
  sections: [{
    id: "section-1",
    title: "发生了什么",
    intent: "解释变化",
    angle: "先事实后影响",
    articleIds: ["a1"],
    keyPoints: ["更低延迟"],
  }],
  titleDirections: [{
    title: "OpenAI 新模型之后",
    angle: "影响",
    reason: "贴近开发者。",
  }],
  coverDirection: {
    visualBrief: "API 控制台",
    textBrief: "模型更新",
    mood: "专业",
  },
  bodyImagePlan: { enabled: false, placements: [] },
  riskNotes: [],
  sourceArticleIds: ["a1"],
};

function createService(content: string): WeixinArticleQualityReviewService {
  const llm: LLMProvider = {
    initialize: () => Promise.resolve(),
    refresh: () => Promise.resolve(),
    setModel: () => {},
    createChatCompletion: () =>
      Promise.resolve({
        choices: [{ message: { content } }],
      }),
  };
  return new WeixinArticleQualityReviewService(llm);
}

function createServiceWithBrand(
  content: string,
  forbiddenTopics: string[],
): WeixinArticleQualityReviewService {
  const llm: LLMProvider = {
    initialize: () => Promise.resolve(),
    refresh: () => Promise.resolve(),
    setModel: () => {},
    createChatCompletion: () =>
      Promise.resolve({ choices: [{ message: { content } }] }),
  };
  return new WeixinArticleQualityReviewService(llm, undefined, {
    forbiddenTopics,
  });
}

Deno.test("quality review service returns normalized AI review", async () => {
  const service = createService(JSON.stringify({
    overallScore: 88,
    allowPublish: true,
    recommendedAction: "publish",
    summary: "整体可发布。",
    dimensionScores: {
      factConsistency: 90,
      titleQuality: 86,
      structureQuality: 88,
      expressionQuality: 84,
      htmlCompliance: 98,
      imageRelevance: 80,
      riskHandling: 82,
    },
    issues: [{
      id: "issue-1",
      category: "tone",
      severity: "low",
      message: "有一句表达略泛。",
      evidence: "值得关注",
      suggestion: "换成具体影响。",
      autoFixable: true,
    }],
    repairSuggestions: ["把泛化表达改成具体影响。"],
  }));

  const review = await service.reviewArticle({
    title: "OpenAI 新模型之后",
    html: "<section><p>正文</p></section>",
    articlePlan,
    topicReport,
    contents,
  });

  assertEquals(review.fallback, false);
  assertEquals(review.overallScore, 88);
  assertEquals(review.issues[0].category, "tone");
  assertEquals(review.recommendedAction, "publish");
});

Deno.test("quality review service falls back to local html scan", async () => {
  const service = createService("not json");

  const review = await service.reviewArticle({
    title: "标题",
    html: `<section><div class="bad">正文</div></section>`,
    articlePlan,
    topicReport,
    contents,
  });

  assertEquals(review.fallback, true);
  assertEquals(review.issues.length, 2);
  assertEquals(review.issues[0].category, "html");
});

Deno.test("normalizeQualityReview blocks high fact issues", () => {
  const review = normalizeQualityReview({
    overallScore: 82,
    issues: [{
      category: "fact",
      severity: "high",
      message: "正文新增了来源没有的信息。",
      suggestion: "删除该结论。",
    }],
  }, false);

  assertEquals(review.recommendedAction, "block");
  assertEquals(review.allowPublish, false);
});

Deno.test("normalizeQualityReview synthesizes issue when action requires revision", () => {
  const review = normalizeQualityReview({
    overallScore: 72,
    allowPublish: false,
    recommendedAction: "revise",
    summary: "事实一致性不足，但模型没有返回 issues。",
    dimensionScores: {
      factConsistency: 62,
      titleQuality: 78,
      structureQuality: 88,
      expressionQuality: 78,
      htmlCompliance: 85,
      imageRelevance: 100,
      riskHandling: 72,
    },
    issues: [],
    repairSuggestions: ["把未被来源支持的付费 API 表述改成开放状态待确认。"],
  }, false);

  assertEquals(review.issues.length, 1);
  assertEquals(review.issues[0].category, "fact");
  assertEquals(review.issues[0].autoFixable, true);
  assertEquals(review.recommendedAction, "revise");
});

Deno.test("quality review blocks explicit gambling promotion locally", async () => {
  const service = createService(JSON.stringify({
    overallScore: 95,
    allowPublish: true,
    recommendedAction: "publish",
    issues: [],
  }));
  const review = await service.reviewArticle({
    title: "活动介绍",
    html: "<section><p>博彩送彩金，点击投注平台开户链接。</p></section>",
    articlePlan,
    topicReport,
    contents,
  });

  assertEquals(review.allowPublish, false);
  assertEquals(review.recommendedAction, "block");
  assertEquals(review.issues[0].id, "compliance-gambling-promotion");
});

Deno.test("quality review does not block neutral risk reporting", async () => {
  const service = createService(JSON.stringify({
    overallScore: 88,
    allowPublish: true,
    recommendedAction: "publish",
    issues: [],
  }));
  const review = await service.reviewArticle({
    title: "监管部门整治网络赌博",
    html:
      "<section><p>报道分析了监管部门打击网络赌博的最新行动。</p></section>",
    articlePlan,
    topicReport,
    contents,
  });

  assertEquals(review.allowPublish, true);
  assertEquals(review.issues.length, 0);
});

Deno.test("quality review blocks configured forbidden topic", async () => {
  const service = createServiceWithBrand(
    JSON.stringify({
      overallScore: 90,
      allowPublish: true,
      recommendedAction: "publish",
      issues: [],
    }),
    ["虚拟币荐币"],
  );
  const review = await service.reviewArticle({
    title: "虚拟币荐币服务观察",
    html: "<section><p>正文</p></section>",
    articlePlan,
    topicReport,
    contents,
  });

  assertEquals(review.allowPublish, false);
  assertEquals(
    review.issues[0].id.startsWith("compliance-forbidden-topic-"),
    true,
  );
});
