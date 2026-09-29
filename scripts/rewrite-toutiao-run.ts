import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { EvidencePack } from "@src/features/weixin-article/domain/evidence.ts";
import { ToutiaoConnectedRewriteService } from "@src/features/weixin-article/services/toutiao-connected-rewrite.service.ts";
import { LlmProviderResolver } from "@src/integrations/llm/llm-provider-resolver.ts";
import {
  initializeAppConfig,
  shutdownAppResources,
} from "@src/utils/config/app-config.ts";

interface FinalTitleArtifact {
  title?: unknown;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await Deno.readTextFile(path)) as T;
}

async function readFirstText(paths: string[]): Promise<string> {
  for (const path of paths) {
    try {
      return await Deno.readTextFile(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      throw error;
    }
  }
  throw new Error(`找不到正文产物：${paths.join("、")}`);
}

const runId = Deno.args[0]?.trim();
if (!runId || !/^[a-zA-Z0-9_-]+$/.test(runId)) {
  throw new Error("用法：deno run -A scripts/rewrite-toutiao-run.ts <runId>");
}

const runDirectory = new URL(`../src/temp/runs/${runId}/`, import.meta.url);
const runPath = decodeURIComponent(runDirectory.pathname.replace(/\/$/, ""));

try {
  const config = await initializeAppConfig();
  const llm = await new LlmProviderResolver(config).getDefaultProvider();
  const service = new ToutiaoConnectedRewriteService(llm);
  const titleArtifact = await readJson<FinalTitleArtifact>(
    `${runPath}/18-final-title.json`,
  );
  const title = typeof titleArtifact.title === "string"
    ? titleArtifact.title.trim()
    : "";
  if (!title) throw new Error("最终标题产物为空");

  const html = await readFirstText([
    `${runPath}/19-final-article.html`,
    `${runPath}/16-revised-article-round-1.html`,
    `${runPath}/12-rendered-article.html`,
  ]);
  const contents = await readJson<ScrapedContent[]>(
    `${runPath}/08-plan-input-contents.json`,
  );
  const evidencePack = await readJson<EvidencePack>(
    `${runPath}/08-evidence-pack.json`,
  );
  const result = await service.rewrite({ title, html, contents, evidencePack });
  await Deno.writeTextFile(
    `${runPath}/20-toutiao-article.json`,
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(JSON.stringify(
    {
      runId,
      ready: result.ready,
      title: result.title,
      safetyPassed: result.safetyPassed,
      networkEvidenceCount: result.networkEvidenceCount,
      verificationNotes: result.verificationNotes,
      removedOrWeakenedClaims: result.removedOrWeakenedClaims,
      error: result.error,
    },
    null,
    2,
  ));
  if (!result.ready) Deno.exitCode = 1;
} finally {
  await shutdownAppResources();
}
