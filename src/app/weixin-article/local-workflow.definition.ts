import {
  createWeixinArticleWorkflowDefinition,
  WeixinArticleWorkflowInput,
} from "@src/app/weixin-article/workflow.definition.ts";
import { createLocalWeixinArticleDependencies } from "@src/app/weixin-article/create-local-weixin-article-dependencies.ts";
import type { WorkflowDefinition } from "@src/core/workflow/workflow-runtime.ts";
import { createLocalArticleRuntimeStores } from "@src/app/weixin-article/local-runtime-stores.ts";

export function createLocalWeixinArticleWorkflowDefinition(): WorkflowDefinition<
  WeixinArticleWorkflowInput
> {
  return createWeixinArticleWorkflowDefinition({
    runtimeConfigStoreFactory: async (config, event) =>
      createLocalArticleRuntimeStores(config, {
        outputDir: event.payload.dryRunOutputDir,
      }).runtimeConfigStore,
    dependencyFactory: async (config, event, runtimeConfig) =>
      await createLocalWeixinArticleDependencies(config, {
        outputDir: event.payload.dryRunOutputDir,
        profileId: runtimeConfig?.profile.id,
        accountId: runtimeConfig?.account?.id ?? event.payload.accountId,
        accountBrand: runtimeConfig?.account?.brand,
        runtimeConfigSnapshot: runtimeConfig?.snapshot,
      }),
  });
}
