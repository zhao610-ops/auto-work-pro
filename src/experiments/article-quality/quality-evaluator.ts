import type {
  ArticleQualityExperimentBranch,
  QualityComparison,
} from "./types.ts";

export class ArticleQualityExperimentEvaluator {
  compare(
    baseline: ArticleQualityExperimentBranch,
    variant: ArticleQualityExperimentBranch,
  ): QualityComparison {
    const diagnostics = collectDiagnostics(baseline, variant);
    const scoreDelta = variant.review.overallScore -
      baseline.review.overallScore;
    const issueDelta = variant.review.issues.length -
      baseline.review.issues.length;
    const validForDecision = diagnostics.length === 0;
    const winner = validForDecision
      ? decideWinner(scoreDelta, issueDelta)
      : "tie";

    return {
      generatedAt: new Date().toISOString(),
      validForDecision,
      diagnostics,
      baseline: toBranchScore(baseline),
      variant: toBranchScore(variant),
      delta: {
        score: scoreDelta,
        issueCount: issueDelta,
      },
      winner,
      summary: validForDecision
        ? summarizeWinner(winner, scoreDelta, issueDelta)
        : `本次实验不适合判断机制有效性：${diagnostics.join("；")}。`,
    };
  }
}

function toBranchScore(branch: ArticleQualityExperimentBranch) {
  return {
    title: branch.title,
    score: branch.review.overallScore,
    action: branch.review.recommendedAction,
    issueCount: branch.review.issues.length,
    revisionApplied: branch.revision?.applied === true,
    review: branch.review,
  };
}

function decideWinner(
  scoreDelta: number,
  issueDelta: number,
): QualityComparison["winner"] {
  if (scoreDelta >= 5 && issueDelta <= 0) return "variant";
  if (scoreDelta <= -5 && issueDelta >= 0) return "baseline";
  return "tie";
}

function summarizeWinner(
  winner: QualityComparison["winner"],
  scoreDelta: number,
  issueDelta: number,
): string {
  const scoreText = scoreDelta >= 0 ? `+${scoreDelta}` : `${scoreDelta}`;
  const issueText = issueDelta >= 0 ? `+${issueDelta}` : `${issueDelta}`;
  if (winner === "variant") {
    return `variant 暂时更优：质量分 ${scoreText}，问题数 ${issueText}。仍需人工复盘正文是否真的更有信息量。`;
  }
  if (winner === "baseline") {
    return `baseline 暂时更优：variant 质量分 ${scoreText}，问题数 ${issueText}。补证据可能引入了噪音。`;
  }
  return `暂未形成明显差异：variant 质量分 ${scoreText}，问题数 ${issueText}。需要结合 HTML 人工判断。`;
}

function collectDiagnostics(
  baseline: ArticleQualityExperimentBranch,
  variant: ArticleQualityExperimentBranch,
): string[] {
  const diagnostics: string[] = [];
  if (baseline.articlePlan.fallback) {
    diagnostics.push(
      `baseline Article Plan 使用兜底${
        formatError(baseline.articlePlan.error)
      }`,
    );
  }
  if (variant.articlePlan.fallback) {
    diagnostics.push(
      `variant Article Plan 使用兜底${formatError(variant.articlePlan.error)}`,
    );
  }
  if (baseline.review.fallback) {
    diagnostics.push(
      `baseline 质量审稿使用兜底${formatError(baseline.review.error)}`,
    );
  }
  if (variant.review.fallback) {
    diagnostics.push(
      `variant 质量审稿使用兜底${formatError(variant.review.error)}`,
    );
  }
  return diagnostics;
}

function formatError(error?: string): string {
  return error ? `：${error}` : "";
}
