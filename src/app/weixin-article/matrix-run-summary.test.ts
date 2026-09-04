import { assertEquals, assertStringIncludes } from "@std/assert";
import { MemoryRunStateStore } from "@src/core/storage/memory-run-state-store.ts";
import { MemoryArtifactStore } from "@src/core/storage/memory-artifact-store.ts";
import {
  buildMatrixRunComparison,
  buildMatrixRunSummary,
  type MatrixRunComparisonReport,
  syncMatrixParentRun,
} from "@src/app/weixin-article/matrix-run-summary.ts";
import type { ArticleRunRecord } from "@src/core/ports/run-state-store.ts";

Deno.test("buildMatrixRunSummary keeps parent queued when no child exists", () => {
  const aggregation = buildMatrixRunSummary({ children: [] });

  assertEquals(aggregation.status, "queued");
  assertEquals(aggregation.total, 0);
  assertStringIncludes(aggregation.summary, "账号结果: 暂无");
});

Deno.test("buildMatrixRunSummary reports running while some children are active", () => {
  const aggregation = buildMatrixRunSummary({
    children: [
      childRun("main", "succeeded"),
      childRun("lab", "queued"),
      childRun("news", "failed"),
    ],
  });

  assertEquals(aggregation.status, "running");
  assertEquals(aggregation.succeeded, 1);
  assertEquals(aggregation.failed, 1);
  assertEquals(aggregation.queued, 1);
  assertStringIncludes(aggregation.summary, "main=succeeded");
  assertStringIncludes(aggregation.summary, "news=failed");
  assertStringIncludes(aggregation.summary, "质量控制:");
  assertStringIncludes(aggregation.summary, "差异化:");
});

Deno.test("buildMatrixRunComparison reports quality control and account differentiation", () => {
  const comparison = buildMatrixRunComparison({
    children: [
      childRun("main", "succeeded", {
        summary: [
          "- 账号: main",
          "- 编辑决策: Gemini 进入智能体时代，deep-analysis",
          "- 文章计划: deep-analysis，4 个章节",
          "- 质量审稿: 92 分，publish",
          "- 发布: DryRun(未发布)",
        ].join("\n"),
      }),
      childRun("lab", "succeeded", {
        summary: [
          "- 账号: lab",
          "- 编辑决策: DeepSeek API 成本战，tool-review",
          "- 文章计划: tool-review，3 个章节",
          "- 质量审稿: 88 分，publish",
          "- 发布: DryRun(未发布)",
        ].join("\n"),
      }),
    ],
  });

  assertEquals(comparison.quality.controlled, true);
  assertEquals(comparison.quality.minScore, 88);
  assertEquals(comparison.differentiation.differentiated, true);
  assertEquals(comparison.differentiation.distinctLeadTopics, 2);
  assertEquals(comparison.differentiation.distinctArticleFormats, 2);
});

Deno.test("syncMatrixParentRun finishes parent when all children succeed", async () => {
  const store = new MemoryRunStateStore();
  const artifactStore = new MemoryArtifactStore();
  await store.startRun({
    runId: "matrix-1",
    runKind: "matrix-parent",
    mode: "local",
    dryRun: true,
    trigger: "manual",
  });
  await store.startRun({
    runId: "matrix-1-main",
    runKind: "matrix-child",
    parentRunId: "matrix-1",
    accountId: "main",
    mode: "local",
    dryRun: true,
    trigger: "manual",
  });
  await store.finishRun("matrix-1-main", {
    summary: "工作流执行完成\n- 质量审稿: 92 分\n- 发布: DryRun",
  });

  const aggregation = await syncMatrixParentRun(store, "matrix-1", {
    artifactStore,
  });
  const parent = await store.getRun("matrix-1");

  assertEquals(aggregation?.status, "succeeded");
  assertEquals(parent?.status, "succeeded");
  assertStringIncludes(parent?.summary ?? "", "main=succeeded(92 分, DryRun)");
  assertStringIncludes(parent?.summary ?? "", "质量控制: 达标 1/1");
  const comparisonRef = parent?.artifacts.find((artifact) =>
    artifact.label === "矩阵账号对比"
  );
  const comparison = await artifactStore.getJson<MatrixRunComparisonReport>(
    comparisonRef!,
  );
  assertEquals(comparison.quality.controlled, true);
});

Deno.test("syncMatrixParentRun fails parent after terminal child failure", async () => {
  const store = new MemoryRunStateStore();
  await store.startRun({
    runId: "matrix-2",
    runKind: "matrix-parent",
    mode: "local",
    dryRun: true,
    trigger: "manual",
  });
  await store.startRun({
    runId: "matrix-2-main",
    runKind: "matrix-child",
    parentRunId: "matrix-2",
    accountId: "main",
    mode: "local",
    dryRun: true,
    trigger: "manual",
  });
  await store.failRun("matrix-2-main", "抓取失败");

  const aggregation = await syncMatrixParentRun(store, "matrix-2");
  const parent = await store.getRun("matrix-2");

  assertEquals(aggregation?.status, "failed");
  assertEquals(parent?.status, "failed");
  assertStringIncludes(parent?.error ?? "", "1 个账号失败");
  assertStringIncludes(parent?.summary ?? "", "main=failed");
});

function childRun(
  accountId: string,
  status: ArticleRunRecord["status"],
  overrides: Partial<ArticleRunRecord> = {},
): ArticleRunRecord {
  return {
    runId: `run-${accountId}`,
    runKind: "matrix-child",
    parentRunId: "matrix",
    accountId,
    mode: "local",
    status,
    dryRun: true,
    trigger: "manual",
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z",
    artifacts: [],
    ...overrides,
  };
}
