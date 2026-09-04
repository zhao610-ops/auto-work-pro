import type { ArticleQualityReview } from "@src/features/weixin-article/domain/quality-review.ts";
import type { ResolvedTrendPublishConfig } from "@src/utils/config/define-config.ts";

export interface QualityGateDecision {
  allowed: boolean;
  bypassed: boolean;
  reason: string;
  action: "allow" | "allow-dry-run" | "bypass" | "disabled" | "block";
}

export type ArticleQualityGateConfig =
  ResolvedTrendPublishConfig["features"]["article"]["qualityGate"];

export function evaluateArticleQualityGate(
  input: {
    review: ArticleQualityReview;
    config: ArticleQualityGateConfig;
    dryRun: boolean;
    forcePublish?: boolean;
  },
): QualityGateDecision {
  if (input.dryRun) {
    return {
      allowed: true,
      bypassed: false,
      action: "allow-dry-run",
      reason: "dry-run 不受质量门禁阻断",
    };
  }

  if (!input.config.enabled) {
    return {
      allowed: true,
      bypassed: false,
      action: "disabled",
      reason: "质量门禁未启用",
    };
  }

  const blockReason = getQualityBlockReason(input.review, input.config);
  if (!blockReason) {
    return {
      allowed: true,
      bypassed: false,
      action: "allow",
      reason: "质量审稿通过",
    };
  }

  const configForcePublish = input.config.forcePublish === true;
  const requestForcePublish = input.forcePublish &&
    input.config.allowForcePublish;
  if (configForcePublish || requestForcePublish) {
    const source = configForcePublish ? "配置项 forcePublish" : "forcePublish";
    return {
      allowed: true,
      bypassed: true,
      action: "bypass",
      reason: `${source} 已绕过质量门禁: ${blockReason}`,
    };
  }

  return {
    allowed: false,
    bypassed: false,
    action: "block",
    reason: blockReason,
  };
}

function getQualityBlockReason(
  review: ArticleQualityReview,
  config: ArticleQualityGateConfig,
): string | null {
  const blocker = review.issues.find((issue) => issue.severity === "blocker");
  if (blocker) return `存在 blocker 问题: ${blocker.message}`;

  if (config.blockOnHighFactIssue) {
    const highFactIssue = review.issues.find((issue) =>
      issue.category === "fact" &&
      (issue.severity === "high" || issue.severity === "blocker")
    );
    if (highFactIssue) {
      return `存在高危事实问题: ${highFactIssue.message}`;
    }
  }

  if (!review.allowPublish) {
    return `审稿结论不允许发布: ${review.recommendedAction}`;
  }

  if (review.recommendedAction !== "publish") {
    return `审稿建议为 ${review.recommendedAction}`;
  }

  if (review.overallScore < config.minScore) {
    return `质量分 ${review.overallScore} 低于门禁 ${config.minScore}`;
  }

  return null;
}
