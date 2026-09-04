import { assertEquals, assertStringIncludes } from "@std/assert";
import { MemoryRunStateStore } from "@src/core/storage/memory-run-state-store.ts";
import { MemoryArtifactStore } from "@src/core/storage/memory-artifact-store.ts";
import { SQLiteRuntimeConfigStore } from "@src/platform/local/sqlite-runtime-config-store.ts";
import {
  runLocalWeixinArticleMatrixDryRun,
} from "@src/app/weixin-article/local-matrix-runner.ts";
import {
  resolveTrendPublishConfig,
  type TrendPublishConfig,
} from "@src/utils/config/define-config.ts";
import {
  seedArticleRuntimeConfig,
} from "@src/app/weixin-article/runtime/article-runtime-config.service.ts";

Deno.test("local matrix runner creates child dry-runs and parent summary per account", async () => {
  const config = resolveTrendPublishConfig(createConfigSource());
  const runtimeConfigStore = new SQLiteRuntimeConfigStore(":memory:");
  const runStateStore = new MemoryRunStateStore();
  const artifactStore = new MemoryArtifactStore();
  await seedArticleRuntimeConfig(runtimeConfigStore, config);
  await runtimeConfigStore.saveWeixinAccountProfile({
    id: "main",
    name: "主账号",
    enabled: true,
    brand: { positioning: "AI 趋势精选" },
    defaults: { sourceGroupIds: ["default"] },
  });
  await runtimeConfigStore.saveWeixinAccountProfile({
    id: "lab",
    name: "工程账号",
    enabled: true,
    brand: { positioning: "工程实践观察" },
    defaults: { sourceGroupIds: ["web"] },
  });

  const capturedAccounts: string[] = [];
  const result = await runLocalWeixinArticleMatrixDryRun(
    config,
    { runtimeConfigStore, runStateStore, artifactStore },
    {
      matrixRunId: "matrix-test",
      accountIds: ["main", "lab"],
      maxArticles: 1,
      runChild: async ({ runId, payload }) => {
        capturedAccounts.push(payload.accountId ?? "");
        await runStateStore.startStep(runId, "fake-render");
        await runStateStore.finishStep(runId, "fake-render", {
          outputArtifacts: [{
            store: "local",
            key: `runs/${runId}/article.html`,
            contentType: "text/html",
          }],
        });
        await runStateStore.finishRun(runId, {
          summary: [
            `- 账号: ${payload.accountId}`,
            `- 编辑决策: ${payload.accountId} 账号主线，deep-analysis`,
            `- 文章计划: ${payload.accountId}-format，3 个章节`,
            "- 质量审稿: 90 分, publish",
            "- 发布: DryRun(未发布)",
          ].join("\n"),
        });
      },
    },
  );

  assertEquals(result.status, "succeeded");
  assertEquals(result.accountIds, ["main", "lab"]);
  assertEquals(capturedAccounts, ["main", "lab"]);
  assertStringIncludes(result.summary ?? "", "main=succeeded");
  assertStringIncludes(result.summary ?? "", "lab=succeeded");
  assertStringIncludes(result.summary ?? "", "质量控制: 达标 2/2");
  assertStringIncludes(result.summary ?? "", "差异化: 已拉开");

  const parent = await runStateStore.getRun("matrix-test");
  const main = await runStateStore.getRun("matrix-test-main");
  const lab = await runStateStore.getRun("matrix-test-lab");
  assertEquals(parent?.status, "succeeded");
  assertEquals(parent?.runKind, "matrix-parent");
  assertEquals(
    parent?.artifacts.some((artifact) => artifact.label === "矩阵账号对比"),
    true,
  );
  assertEquals(main?.runKind, "matrix-child");
  assertEquals(main?.accountId, "main");
  assertEquals(lab?.runKind, "matrix-child");
  assertEquals(lab?.accountId, "lab");
  assertEquals(main?.artifacts.length, 1);
  assertEquals(lab?.artifacts.length, 1);
});

function createConfigSource(): TrendPublishConfig {
  return {
    providers: {
      ai: {
        baseUrl: "https://example.com/v1",
        apiKey: "secret",
        model: "chat-model",
      },
      fetch: {
        firecrawl: { apiKey: "firecrawl" },
        jina: { apiKey: "jina" },
      },
      image: {
        dashscope: { apiKey: "dashscope" },
      },
      vector: {
        embedding: {
          baseUrl: "https://example.com/v1",
          apiKey: "embedding",
          model: "embedding-model",
        },
      },
    },
    fetchGroups: {
      default: ["auto"],
      web: ["firecrawl", "jina"],
    },
    features: {
      article: {
        sources: [
          "https://example.com/default",
          "web:https://example.com/web",
        ],
        renderer: {
          template: "dynamic",
          promptProfile: "technology",
        },
        count: 5,
        dryRun: true,
      },
    },
  };
}
