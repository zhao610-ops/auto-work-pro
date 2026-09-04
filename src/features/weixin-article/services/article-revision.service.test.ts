import { assertEquals } from "@std/assert";
import type { LLMProvider } from "@src/core/ports/llm.ts";
import type { ArticleQualityReview } from "@src/features/weixin-article/domain/quality-review.ts";
import {
  normalizeArticleRevision,
  WeixinArticleRevisionService,
} from "@src/features/weixin-article/services/article-revision.service.ts";

const html =
  `<section style="margin:0;"><p style="margin:0;">正文</p></section>`;
const review: ArticleQualityReview = {
  generatedAt: "2026-05-23T00:00:00.000Z",
  fallback: false,
  overallScore: 73,
  allowPublish: true,
  recommendedAction: "dry-run-only",
  summary: "标题范围过窄。",
  dimensionScores: {
    factConsistency: 80,
    titleQuality: 55,
    structureQuality: 80,
    expressionQuality: 80,
    htmlCompliance: 90,
    imageRelevance: 80,
    riskHandling: 80,
  },
  issues: [{
    id: "issue-1",
    category: "title",
    severity: "medium",
    message: "标题范围过窄。",
    suggestion: "改成覆盖两个主题的标题。",
    autoFixable: true,
  }],
  repairSuggestions: ["改标题"],
};

function createService(content: string): WeixinArticleRevisionService {
  const llm: LLMProvider = {
    initialize: () => Promise.resolve(),
    refresh: () => Promise.resolve(),
    setModel: () => {},
    createChatCompletion: () =>
      Promise.resolve({ choices: [{ message: { content } }] }),
  };
  return new WeixinArticleRevisionService(llm);
}

Deno.test("article revision service applies safe title repair", async () => {
  const service = createService(JSON.stringify({
    applied: true,
    title: "两条 AI 工具新信号",
    html,
    changes: [{
      issueId: "issue-1",
      field: "title",
      before: "Superset 上线",
      after: "两条 AI 工具新信号",
      reason: "覆盖正文两个主题。",
    }],
    skippedIssueIds: [],
  }));

  const result = await service.reviseArticle({
    round: 1,
    title: "Superset 上线",
    html,
    articlePlan: {
      generatedAt: "2026-05-23T00:00:00.000Z",
      fallback: false,
      format: "mixed",
      thesis: "两个 AI 工具主题。",
      targetReader: "开发者",
      summary: "短讯组合。",
      sections: [],
      titleDirections: [],
      coverDirection: { visualBrief: "", textBrief: "", mood: "" },
      bodyImagePlan: { enabled: false, placements: [] },
      riskNotes: [],
      sourceArticleIds: [],
    },
    qualityReview: review,
    contents: [],
  });

  assertEquals(result.applied, true);
  assertEquals(result.changedFields, ["title"]);
  assertEquals(result.title, "两条 AI 工具新信号");
});

Deno.test("article revision skips when there are no safe auto-fixable issues", async () => {
  const service = createService("{}");
  const result = await service.reviseArticle({
    round: 1,
    title: "标题",
    html,
    articlePlan: {
      generatedAt: "2026-05-23T00:00:00.000Z",
      fallback: false,
      format: "mixed",
      thesis: "",
      targetReader: "",
      summary: "",
      sections: [],
      titleDirections: [],
      coverDirection: { visualBrief: "", textBrief: "", mood: "" },
      bodyImagePlan: { enabled: false, placements: [] },
      riskNotes: [],
      sourceArticleIds: [],
    },
    qualityReview: {
      ...review,
      issues: [{ ...review.issues[0], severity: "blocker" }],
    },
    contents: [],
  });

  assertEquals(result.applied, false);
});

Deno.test("article revision attempts high fact issues when marked auto-fixable", async () => {
  const service = createService(JSON.stringify({
    applied: true,
    title: "事实修正标题",
    html:
      `<section style="margin:0;"><p style="margin:0;">已收敛成来源支持的表述。</p></section>`,
    changes: [{
      issueId: "issue-1",
      field: "html",
      before: "不可靠事实",
      after: "来源支持的表述",
      reason: "高风险事实问题已被审稿标记为可自动修复。",
    }],
    skippedIssueIds: [],
  }));
  const result = await service.reviseArticle({
    round: 1,
    title: "标题",
    html,
    articlePlan: {
      generatedAt: "2026-05-23T00:00:00.000Z",
      fallback: false,
      format: "deep-analysis",
      thesis: "",
      targetReader: "",
      summary: "",
      sections: [],
      titleDirections: [],
      coverDirection: { visualBrief: "", textBrief: "", mood: "" },
      bodyImagePlan: { enabled: false, placements: [] },
      riskNotes: [],
      sourceArticleIds: [],
    },
    qualityReview: {
      ...review,
      issues: [{ ...review.issues[0], category: "fact", severity: "high" }],
    },
    contents: [],
  });

  assertEquals(result.applied, true);
  assertEquals(result.changedFields, ["title", "html"]);
});

Deno.test("normalizeArticleRevision falls back from invalid html only", () => {
  const result = normalizeArticleRevision({
    applied: true,
    title: "5 月 23 日 AI 速递 | 新标题",
    html: "<p>不是 section</p>",
    changes: [],
  }, {
    round: 1,
    title: "旧标题",
    html,
    qualityReview: review,
  }, false);

  assertEquals(result.title, "5 月 23 日 AI 速递 | 新标题");
  assertEquals(result.html, html);
  assertEquals(result.changedFields, ["title"]);
});
