import { assertEquals } from "@std/assert";
import {
  shouldAcceptArticleRevision,
  shouldReviseArticle,
} from "@src/features/weixin-article/workflow.ts";
import type {
  ArticleQualityReview,
  QualityIssue,
} from "@src/features/weixin-article/domain/quality-review.ts";

Deno.test("shouldReviseArticle includes auto-fixable high fact issues", () => {
  assertEquals(
    shouldReviseArticle(review({
      category: "fact",
      severity: "high",
      autoFixable: true,
    })),
    true,
  );
});

Deno.test("shouldReviseArticle skips blocker issues even when marked auto-fixable", () => {
  assertEquals(
    shouldReviseArticle(review({
      category: "structure",
      severity: "blocker",
      autoFixable: true,
    })),
    false,
  );
});

Deno.test("shouldReviseArticle includes safe editorial issues even when model omits autoFixable", () => {
  assertEquals(
    shouldReviseArticle(review({
      category: "title",
      severity: "high",
      autoFixable: false,
    })),
    true,
  );
});

Deno.test("shouldAcceptArticleRevision rejects lower quality revision", () => {
  assertEquals(
    shouldAcceptArticleRevision(
      review({
        severity: "medium",
        autoFixable: true,
      }, {
        overallScore: 85,
        allowPublish: true,
        recommendedAction: "dry-run-only",
      }),
      review({
        severity: "blocker",
        autoFixable: false,
      }, {
        overallScore: 58,
        allowPublish: false,
        recommendedAction: "revise",
      }),
    ),
    false,
  );
});

Deno.test("shouldAcceptArticleRevision accepts improved action rank", () => {
  assertEquals(
    shouldAcceptArticleRevision(
      review({
        severity: "high",
        autoFixable: true,
      }, {
        overallScore: 78,
        allowPublish: false,
        recommendedAction: "revise",
      }),
      review({
        severity: "low",
        autoFixable: true,
      }, {
        overallScore: 80,
        allowPublish: true,
        recommendedAction: "dry-run-only",
      }),
    ),
    true,
  );
});

function review(
  issue: Partial<QualityIssue>,
  overrides: Partial<ArticleQualityReview> = {},
): ArticleQualityReview {
  return {
    generatedAt: "2026-05-30T00:00:00.000Z",
    fallback: false,
    overallScore: 72,
    allowPublish: false,
    recommendedAction: "revise",
    summary: "需要修订。",
    dimensionScores: {
      factConsistency: 60,
      titleQuality: 80,
      structureQuality: 80,
      expressionQuality: 80,
      htmlCompliance: 80,
      imageRelevance: 80,
      riskHandling: 80,
    },
    repairSuggestions: [],
    issues: [{
      id: "issue-1",
      category: issue.category ?? "fact",
      severity: issue.severity ?? "medium",
      message: "问题",
      suggestion: "修复",
      autoFixable: issue.autoFixable ?? false,
    }],
    ...overrides,
  };
}
