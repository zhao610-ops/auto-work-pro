import { LocalWorkflowRuntime } from "@src/core/workflow/local-workflow-runtime.ts";
import { createLocalWeixinArticleWorkflowDefinition } from "@src/app/weixin-article/local-workflow.definition.ts";
import {
  seedArticleRuntimeConfig,
} from "@src/app/weixin-article/runtime/article-runtime-config.service.ts";
import { syncMatrixParentRun } from "@src/app/weixin-article/matrix-run-summary.ts";
import type { RuntimeConfigStore } from "@src/core/ports/runtime-config-store.ts";
import type { ArtifactStore } from "@src/core/ports/artifact-store.ts";
import type {
  RunStateStore,
  RunStatus,
} from "@src/core/ports/run-state-store.ts";
import type { ResolvedTrendPublishConfig } from "@src/utils/config/define-config.ts";
import type { ArticleSourceFilter } from "@src/features/weixin-article/services/content-scrape.service.ts";
import type { WeixinArticleWorkflowInput } from "@src/app/weixin-article/workflow.definition.ts";

export interface LocalMatrixRuntimeStores {
  runtimeConfigStore: RuntimeConfigStore;
  runStateStore: RunStateStore;
  artifactStore?: ArtifactStore;
}

export interface LocalWeixinArticleMatrixDryRunOptions {
  accountIds?: string[];
  profileId?: string;
  dryRunOutputDir?: string;
  maxArticles?: number;
  sourceType?: ArticleSourceFilter;
  matrixRunId?: string;
  runChild?: (input: {
    runId: string;
    payload: WeixinArticleWorkflowInput;
  }) => Promise<void>;
}

export interface LocalWeixinArticleMatrixDryRunResult {
  matrixRunId: string;
  accountIds: string[];
  childRunIds: string[];
  status?: RunStatus;
  summary?: string;
}

export async function runLocalWeixinArticleMatrixDryRun(
  config: ResolvedTrendPublishConfig,
  stores: LocalMatrixRuntimeStores,
  options: LocalWeixinArticleMatrixDryRunOptions = {},
): Promise<LocalWeixinArticleMatrixDryRunResult> {
  await seedArticleRuntimeConfig(stores.runtimeConfigStore, config);
  const accounts = await stores.runtimeConfigStore.listWeixinAccountProfiles();
  const selectedAccountIds = options.accountIds?.length
    ? [...new Set(options.accountIds.map((id) => id.trim()).filter(Boolean))]
    : accounts.filter((account) => account.enabled).map((account) =>
      account.id
    );

  if (selectedAccountIds.length === 0) {
    throw new Error(
      "没有可运行的公众号账号，请先在 Dashboard 账号矩阵中启用账号",
    );
  }

  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const missing = selectedAccountIds.filter((id) => !accountById.has(id));
  if (missing.length > 0) {
    throw new Error(`公众号账号不存在: ${missing.join(", ")}`);
  }

  const disabled = selectedAccountIds.filter((id) =>
    accountById.get(id)?.enabled === false
  );
  if (disabled.length > 0) {
    throw new Error(`公众号账号已禁用: ${disabled.join(", ")}`);
  }

  const matrixRunId = options.matrixRunId ?? `matrix-${crypto.randomUUID()}`;
  await stores.runStateStore.startRun({
    runId: matrixRunId,
    runKind: "matrix-parent",
    mode: "local",
    dryRun: true,
    trigger: "manual",
    profileId: options.profileId,
  });

  const childRunIds: string[] = [];
  for (const accountId of selectedAccountIds) {
    const runId = `${matrixRunId}-${accountId}`;
    childRunIds.push(runId);
    await stores.runStateStore.startRun({
      runId,
      runKind: "matrix-child",
      parentRunId: matrixRunId,
      accountId,
      profileId: options.profileId,
      mode: "local",
      dryRun: true,
      trigger: "manual",
    });
    await stores.runStateStore.updateRun(runId, { status: "queued" });

    const payload: WeixinArticleWorkflowInput = {
      runId,
      runKind: "matrix-child",
      parentRunId: matrixRunId,
      trigger: "manual",
      dryRun: true,
      dryRunOutputDir: options.dryRunOutputDir,
      maxArticles: options.maxArticles,
      sourceType: options.sourceType,
      profileId: options.profileId,
      accountId,
    };

    try {
      await (options.runChild ?? runLocalWorkflowChild)({ runId, payload });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await stores.runStateStore.failRun(runId, message).catch(() => {});
      console.warn(`[矩阵运行] 账号 ${accountId} 执行失败: ${message}`);
    } finally {
      await syncMatrixParentRun(stores.runStateStore, matrixRunId, {
        artifactStore: stores.artifactStore,
      }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[矩阵运行] 父批次状态同步失败: ${message}`);
      });
    }
  }

  const aggregation = await syncMatrixParentRun(
    stores.runStateStore,
    matrixRunId,
    { artifactStore: stores.artifactStore },
  );
  return {
    matrixRunId,
    accountIds: selectedAccountIds,
    childRunIds,
    status: aggregation?.status,
    summary: aggregation?.summary,
  };
}

async function runLocalWorkflowChild(
  input: { runId: string; payload: WeixinArticleWorkflowInput },
): Promise<void> {
  const runtime = new LocalWorkflowRuntime();
  await runtime.run(createLocalWeixinArticleWorkflowDefinition(), {
    payload: input.payload,
    id: input.runId,
    timestamp: Date.now(),
  });
}
