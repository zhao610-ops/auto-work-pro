import { assertEquals } from "@std/assert";
import type { ArticleQualityReview } from "@src/features/weixin-article/domain/quality-review.ts";
import {
  evaluateArticleQualityGate,
  resolveArticlePublishMode,
} from "@src/features/weixin-article/services/quality-gate.service.ts";

const baseConfig = {
  enabled: true,
  minScore: 80,
  blockOnHighFactIssue: true,
  forcePublish: false,
  allowForcePublish: true,
  maxRevisionRounds: 1,
};

const baseReview: ArticleQualityReview = {
  generatedAt: "2026-05-23T00:00:00.000Z",
  fallback: false,
  overallScore: 88,
  allowPublish: true,
  recommendedAction: "publish",
  summary: "可发布",
  dimensionScores: {
    factConsistency: 90,
    titleQuality: 90,
    structureQuality: 88,
    expressionQuality: 86,
    htmlCompliance: 100,
    imageRelevance: 80,
    riskHandling: 82,
  },
  issues: [],
  repairSuggestions: [],
};

Deno.test("quality gate never blocks dry-run", () => {
  const decision = evaluateArticleQualityGate({
    review: { ...baseReview, overallScore: 20, allowPublish: false },
    config: baseConfig,
    dryRun: true,
  });

  assertEquals(decision.allowed, true);
  assertEquals(decision.action, "allow-dry-run");
});

Deno.test("quality gate allows publish when disabled", () => {
  const decision = evaluateArticleQualityGate({
    review: { ...baseReview, overallScore: 20, allowPublish: false },
    config: { ...baseConfig, enabled: false },
    dryRun: false,
  });

  assertEquals(decision.allowed, true);
  assertEquals(decision.action, "disabled");
});

Deno.test("quality gate blocks low score real publish", () => {
  const decision = evaluateArticleQualityGate({
    review: { ...baseReview, overallScore: 70 },
    config: baseConfig,
    dryRun: false,
  });

  assertEquals(decision.allowed, false);
  assertEquals(decision.action, "block");
});

Deno.test("quality gate blocks high fact issue", () => {
  const decision = evaluateArticleQualityGate({
    review: {
      ...baseReview,
      issues: [{
        id: "issue-1",
        category: "fact",
        severity: "high",
        message: "正文新增了来源不支持的融资金额。",
        suggestion: "删除该金额。",
        autoFixable: true,
      }],
    },
    config: baseConfig,
    dryRun: false,
  });

  assertEquals(decision.allowed, false);
  assertEquals(decision.reason.includes("高危事实问题"), true);
});

Deno.test("quality gate can be bypassed by forcePublish when allowed", () => {
  const decision = evaluateArticleQualityGate({
    review: { ...baseReview, overallScore: 70 },
    config: baseConfig,
    dryRun: false,
    forcePublish: true,
  });

  assertEquals(decision.allowed, true);
  assertEquals(decision.bypassed, true);
  assertEquals(decision.action, "bypass");
});

Deno.test("quality gate can be bypassed by config forcePublish", () => {
  const decision = evaluateArticleQualityGate({
    review: { ...baseReview, overallScore: 70 },
    config: {
      ...baseConfig,
      forcePublish: true,
      allowForcePublish: false,
    },
    dryRun: false,
  });

  assertEquals(decision.allowed, true);
  assertEquals(decision.bypassed, true);
  assertEquals(decision.reason.includes("配置项 forcePublish"), true);
});

Deno.test("quality gate never bypasses local compliance blockers", () => {
  const decision = evaluateArticleQualityGate({
    review: {
      ...baseReview,
      issues: [{
        id: "compliance-gambling-promotion",
        category: "risk",
        severity: "blocker",
        message: "正文包含赌博推广信息。",
        suggestion: "删除相关内容。",
        autoFixable: false,
      }],
    },
    config: { ...baseConfig, forcePublish: true },
    dryRun: false,
    forcePublish: true,
  });

  assertEquals(decision.allowed, false);
  assertEquals(decision.bypassed, false);
  assertEquals(decision.reason.includes("不可绕过的合规问题"), true);
});

Deno.test("draft mode always keeps the article in the draft box", () => {
  const resolution = resolveArticlePublishMode("draft", {
    allowed: true,
    bypassed: false,
    action: "allow",
    reason: "质量审稿通过",
  });

  assertEquals(resolution, { publishMode: "draft" });
});

Deno.test("publish mode directly publishes an article that passes the gate", () => {
  const resolution = resolveArticlePublishMode("publish", {
    allowed: true,
    bypassed: false,
    action: "allow",
    reason: "质量审稿通过",
  });

  assertEquals(resolution, { publishMode: "publish" });
});

Deno.test("publish mode downgrades a low-score article to a draft", () => {
  const resolution = resolveArticlePublishMode("publish", {
    allowed: false,
    bypassed: false,
    action: "block",
    reason: "质量分 79 低于门禁 80",
  });

  assertEquals(resolution.publishMode, "draft");
  assertEquals(
    resolution.downgradeReason,
    "未自动公开发布，已保留草稿: 质量分 79 低于门禁 80",
  );
});

Deno.test("draft fallback always downgrades public publishing to a draft", () => {
  const resolution = resolveArticlePublishMode("publish", {
    allowed: true,
    bypassed: true,
    action: "bypass",
    reason: "forcePublish 已绕过质量门禁",
  }, {
    requiresDraft: true,
    reason: "AI 正文起草失败，使用了本地正文兜底",
  });

  assertEquals(resolution.publishMode, "draft");
  assertEquals(resolution.downgradeReason?.includes("AI 正文起草失败"), true);
});
