import type { ArticleQualityReview } from "@src/features/weixin-article/domain/quality-review.ts";
import type { ResolvedTrendPublishConfig } from "@src/utils/config/define-config.ts";
import type { ArticlePublishMode } from "@src/utils/config/define-config.ts";

export interface QualityGateDecision {
  allowed: boolean;
  bypassed: boolean;
  reason: string;
  action: "allow" | "allow-dry-run" | "bypass" | "disabled" | "block";
}

export interface ArticlePublishModeDecision {
  publishMode: ArticlePublishMode;
  downgradeReason?: string;
}

export type ArticleQualityGateConfig =
  ResolvedTrendPublishConfig["features"]["article"]["qualityGate"];

/** 只有事实高风险和合规问题会阻止定时群发，普通编辑问题交给自动修订。 */
export function getHardQualityBlockReason(
  review: ArticleQualityReview,
  config: ArticleQualityGateConfig,
): string | null {
  const complianceBlocker = review.issues.find((issue) =>
    issue.severity === "blocker" && issue.id.startsWith("compliance-")
  );
  if (complianceBlocker) {
    return `存在不可绕过的合规问题: ${complianceBlocker.message}`;
  }
  if (config.blockOnHighFactIssue) {
    const highFactIssue = review.issues.find((issue) =>
      issue.category === "fact" &&
      (issue.severity === "high" || issue.severity === "blocker")
    );
    if (highFactIssue) return `存在高危事实问题: ${highFactIssue.message}`;
  }
  return null;
}

/**
 * 定时群发比普通草稿更严格：只有质量门禁明确放行的内容才可进入发送队列。
 * `forcePublish` 只能用于人工发起的特殊流程，不能让定时群发绕过质量结论。
 */
export function getScheduledMassSendBlockReason(
  decision: QualityGateDecision,
): string | null {
  if (!decision.allowed) return decision.reason;
  if (decision.bypassed) {
    return "定时群发不允许绕过质量门禁";
  }
  return null;
}

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

  const hardBlockReason = getHardQualityBlockReason(input.review, input.config);
  if (hardBlockReason) {
    return {
      allowed: false,
      bypassed: false,
      action: "block",
      reason: hardBlockReason,
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

export function resolveArticlePublishMode(
  configuredPublishMode: ArticlePublishMode,
  qualityGateDecision: QualityGateDecision,
  protection?: { requiresDraft: boolean; reason: string },
): ArticlePublishModeDecision {
  if (protection?.requiresDraft && configuredPublishMode !== "draft") {
    return {
      publishMode: "draft",
      downgradeReason: `未自动公开发布，已保留草稿: ${protection.reason}`,
    };
  }

  if (configuredPublishMode === "mass" && qualityGateDecision.bypassed) {
    return {
      publishMode: "draft",
      downgradeReason:
        `未自动群发，已保留草稿: 群发不允许绕过质量门禁（${qualityGateDecision.reason}）`,
    };
  }

  if (configuredPublishMode === "draft" || qualityGateDecision.allowed) {
    return { publishMode: configuredPublishMode };
  }

  return {
    publishMode: "draft",
    downgradeReason:
      `未自动公开发布，已保留草稿: ${qualityGateDecision.reason}`,
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
