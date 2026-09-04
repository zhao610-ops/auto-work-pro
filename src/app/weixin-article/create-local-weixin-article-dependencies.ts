import {
  createWeixinArticleDependencies,
  CreateWeixinArticleDependenciesOptions,
} from "@src/app/weixin-article/create-weixin-article-dependencies.ts";
import { LocalArtifactStore } from "@src/platform/local/local-artifact-store.ts";
import { LocalJsonRunStateStore } from "@src/platform/local/local-json-run-state-store.ts";
import { SQLiteEditorialMemoryStore } from "@src/platform/local/sqlite-editorial-memory-store.ts";
import type { ResolvedTrendPublishConfig } from "@src/utils/config/define-config.ts";
import { join } from "node:path";

export async function createLocalWeixinArticleDependencies(
  config: ResolvedTrendPublishConfig,
  options:
    & Omit<
      CreateWeixinArticleDependenciesOptions,
      "artifactStore" | "runStateStore" | "mode"
    >
    & { outputDir?: string } = {},
) {
  const outputDir = options.outputDir ||
    config.storage.artifacts.outputDir ||
    config.storage.runState.outputDir ||
    "src/temp";
  const baseDir = join(Deno.cwd(), outputDir);
  return await createWeixinArticleDependencies(config, {
    ...options,
    artifactStore: new LocalArtifactStore(baseDir),
    runStateStore: new LocalJsonRunStateStore(baseDir),
    editorialMemoryStore: options.editorialMemoryStore ??
      new SQLiteEditorialMemoryStore(config.storage.runtimeConfig.sqlitePath),
    mode: "local",
    vectorStoreFactory: options.vectorStoreFactory ?? (async () => {
      const { SQLiteVectorStore } = await import(
        "@src/integrations/vector/sqlite-vector-store.ts"
      );
      return new SQLiteVectorStore(config.storage.vector.sqlitePath);
    }),
  });
}
