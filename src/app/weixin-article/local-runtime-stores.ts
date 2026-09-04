import { LocalArtifactStore } from "@src/platform/local/local-artifact-store.ts";
import { LocalJsonRunStateStore } from "@src/platform/local/local-json-run-state-store.ts";
import { SQLiteRuntimeConfigStore } from "@src/platform/local/sqlite-runtime-config-store.ts";
import { SQLiteEditorialMemoryStore } from "@src/platform/local/sqlite-editorial-memory-store.ts";
import type { ResolvedTrendPublishConfig } from "@src/utils/config/define-config.ts";
import { join } from "node:path";

export function createLocalArticleRuntimeStores(
  config: ResolvedTrendPublishConfig,
  options: { outputDir?: string } = {},
) {
  const outputDir = options.outputDir ||
    config.storage.artifacts.outputDir ||
    config.storage.runState.outputDir ||
    "src/temp";
  const baseDir = join(Deno.cwd(), outputDir);
  return {
    artifactStore: new LocalArtifactStore(baseDir),
    runStateStore: new LocalJsonRunStateStore(baseDir),
    runtimeConfigStore: new SQLiteRuntimeConfigStore(
      config.storage.runtimeConfig.sqlitePath,
    ),
    editorialMemoryStore: new SQLiteEditorialMemoryStore(
      config.storage.runtimeConfig.sqlitePath,
    ),
  };
}
