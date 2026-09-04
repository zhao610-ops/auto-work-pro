import { WeixinArticleWorkflow } from "@src/features/weixin-article/workflow.ts";
import { createWeixinArticleDependencies } from "@src/app/weixin-article/create-weixin-article-dependencies.ts";
import type { WeixinArticleDependencies } from "@src/features/weixin-article/dependencies.ts";
import {
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowStepContext,
} from "@src/core/workflow/workflow-runtime.ts";
import { getAppConfig } from "@src/utils/config/app-config.ts";
import type { ResolvedTrendPublishConfig } from "@src/utils/config/define-config.ts";
import type { RuntimeConfigStore } from "@src/core/ports/runtime-config-store.ts";
import {
  resolveArticleRuntimeConfig,
} from "@src/app/weixin-article/runtime/article-runtime-config.service.ts";
import type { ResolvedArticleRuntimeConfig } from "@src/app/weixin-article/runtime/article-runtime-config.ts";
import type { ArticleSourceFilter } from "@src/features/weixin-article/services/content-scrape.service.ts";

export interface WeixinArticleWorkflowInput {
  sourceType?: ArticleSourceFilter;
  maxArticles?: number;
  forcePublish?: boolean;
  dryRun?: boolean;
  dryRunOutputDir?: string;
  runId?: string;
  trigger?: "manual" | "cron";
  profileId?: string;
  accountId?: string;
  runKind?: "single" | "matrix-parent" | "matrix-child";
  parentRunId?: string;
}

export const WEIXIN_ARTICLE_WORKFLOW_ID = "weixin-article-workflow";

export type WeixinArticleDependencyFactory = (
  config: ResolvedTrendPublishConfig,
  event: WorkflowEvent<WeixinArticleWorkflowInput>,
  runtimeConfig?: ResolvedArticleRuntimeConfig,
) => Promise<WeixinArticleDependencies>;

export type WeixinArticleRuntimeConfigStoreFactory = (
  config: ResolvedTrendPublishConfig,
  event: WorkflowEvent<WeixinArticleWorkflowInput>,
) => Promise<RuntimeConfigStore>;

export interface CreateWeixinArticleWorkflowDefinitionOptions {
  dependencyFactory?: WeixinArticleDependencyFactory;
  runtimeConfigStoreFactory?: WeixinArticleRuntimeConfigStoreFactory;
}

export function createWeixinArticleWorkflowDefinition(
  dependencyFactoryOrOptions?:
    | WeixinArticleDependencyFactory
    | CreateWeixinArticleWorkflowDefinitionOptions,
): WorkflowDefinition<WeixinArticleWorkflowInput> {
  const options = typeof dependencyFactoryOrOptions === "function"
    ? { dependencyFactory: dependencyFactoryOrOptions }
    : dependencyFactoryOrOptions ?? {};
  return {
    id: WEIXIN_ARTICLE_WORKFLOW_ID,
    run: async (
      event: WorkflowEvent<WeixinArticleWorkflowInput>,
      step: WorkflowStepContext,
    ) => {
      const baseConfig = await getAppConfig();
      const runtimeConfig = options.runtimeConfigStoreFactory
        ? await resolveArticleRuntimeConfig(
          await options.runtimeConfigStoreFactory(baseConfig, event),
          baseConfig,
          event.payload.profileId,
          event.payload.accountId,
        )
        : undefined;
      const config = runtimeConfig?.config ?? baseConfig;
      const dependencies = options.dependencyFactory
        ? await options.dependencyFactory(config, event, runtimeConfig)
        : await createWeixinArticleDependencies(config, {
          profileId: runtimeConfig?.profile.id,
          accountId: runtimeConfig?.account?.id ?? event.payload.accountId,
          accountBrand: runtimeConfig?.account?.brand,
          runtimeConfigSnapshot: runtimeConfig?.snapshot,
        });
      const workflow = new WeixinArticleWorkflow({
        id: WEIXIN_ARTICLE_WORKFLOW_ID,
        name: WEIXIN_ARTICLE_WORKFLOW_ID,
      }, dependencies);
      return await workflow.run(event, step);
    },
  };
}
