import type {
  ArticleQualityExperimentBranch,
  ArticleQualityExperimentOptions,
  EvidencePack,
  QualityComparison,
} from "./types.ts";

export function renderHypothesis(options: ArticleQualityExperimentOptions) {
  return `# 文章质量实验假设

实验 ID：${options.experimentId}

## Hypothesis

${options.hypothesis}

## 固定边界

- 实验只跑 dry-run，不触发真实发布。
- baseline 和 variant 使用同一份 input snapshot。
- variant 只验证补充搜索、EvidencePack 和有限修订是否改善文章质量。
- 实验结论必须人工确认，不自动进入主流程。
`;
}

export function renderConclusion(input: {
  options: ArticleQualityExperimentOptions;
  comparison: QualityComparison;
  evidencePack: EvidencePack;
  baseline: ArticleQualityExperimentBranch;
  variant: ArticleQualityExperimentBranch;
}) {
  return `# 文章质量实验结论

实验 ID：${input.options.experimentId}

## 自动评分摘要

- baseline：${input.comparison.baseline.score} 分，${input.comparison.baseline.action}，问题 ${input.comparison.baseline.issueCount} 个
- variant：${input.comparison.variant.score} 分，${input.comparison.variant.action}，问题 ${input.comparison.variant.issueCount} 个
- 分数变化：${formatSigned(input.comparison.delta.score)}
- 问题数变化：${formatSigned(input.comparison.delta.issueCount)}
- 自动判断：${input.comparison.winner}
- 是否可用于机制结论：${input.comparison.validForDecision ? "是" : "否"}

${input.comparison.summary}

${
    input.comparison.diagnostics.length
      ? `## 运行诊断

${input.comparison.diagnostics.map((item) => `- ${item}`).join("\n")}
`
      : ""
  }

## 证据补充摘要

- 搜索 Query：${input.evidencePack.queries.length} 个
- 证据条目：${input.evidencePack.items.length} 条
- 缺口：${input.evidencePack.gaps.length} 条

## 人工复盘

- [ ] variant 是否真的比 baseline 信息密度更高？
- [ ] variant 是否引入了无关来源或噪音？
- [ ] variant 是否减少了 unsupported claim？
- [ ] variant 的结构是否更清楚？
- [ ] 这个实验假设是否值得转成正式 workflow step？

## 结论

填写人工结论：

- 结论：有效 / 部分有效 / 无效
- 保留能力：
- 删除能力：
- 需要下一轮实验的问题：
`;
}

function formatSigned(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}
