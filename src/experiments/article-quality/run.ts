import { ArticleFetchRouter } from "@src/app/weixin-article/fetch/article-fetch-router.ts";
import { resolveSourceProviders } from "@src/app/weixin-article/fetch/article-fetch-planner.ts";
import { createLocalArticleRuntimeStores } from "@src/app/weixin-article/local-runtime-stores.ts";
import { createLocalWeixinArticleDependencies } from "@src/app/weixin-article/create-local-weixin-article-dependencies.ts";
import { resolveArticleRuntimeConfig } from "@src/app/weixin-article/runtime/article-runtime-config.service.ts";
import {
  FetchProviderId,
  fetchProviderRegistry,
  isSearchFetchProvider,
} from "@src/integrations/fetch/fetch-provider-registry.ts";
import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { ArticleRevisionResult } from "@src/features/weixin-article/domain/article-revision.ts";
import type { ArticleQualityReview } from "@src/features/weixin-article/domain/quality-review.ts";
import type { WeixinArticleDependencies } from "@src/features/weixin-article/dependencies.ts";
import type { ArticleSourceFilter } from "@src/features/weixin-article/services/content-scrape.service.ts";
import {
  getAppConfig,
  initializeAppConfig,
  parseConfigArgs,
  shutdownAppResources,
  validateAppConfig,
} from "@src/utils/config/app-config.ts";
import type { ResolvedTrendPublishConfig } from "@src/utils/config/define-config.ts";
import { join } from "node:path";
import { ArticleQualityExperimentEvaluator } from "./quality-evaluator.ts";
import { ArticleQualityResearchService } from "./research.service.ts";
import { renderConclusion, renderHypothesis } from "./report.ts";
import type {
  ArticleQualityExperimentBranch,
  ArticleQualityExperimentOptions,
  ArticleQualityExperimentSnapshot,
} from "./types.ts";

interface CliOptions {
  profileId?: string;
  sourceType?: ArticleSourceFilter;
  maxArticles?: number;
  maxResearchQueries: number;
  maxResultsPerQuery: number;
  maxRevisionRounds: number;
  outputDir?: string;
  experimentId?: string;
  hypothesis: string;
}

const DEFAULT_HYPOTHESIS =
  "补充搜索证据并在写作前提供 EvidencePack，可以提升文章事实支撑和信息密度，同时不显著降低结构清晰度。";

const parsedConfigArgs = parseConfigArgs(Deno.args);
const cliOptions = parseArgs(parsedConfigArgs.args);

try {
  await initializeAppConfig({ configPath: parsedConfigArgs.configPath });
  await validateAppConfig({
    requireLLM: true,
    requireWeixinPublish: false,
  });
  const result = await runArticleQualityExperiment(cliOptions);
  console.log(`文章质量实验完成:
  - 实验 ID: ${result.experimentId}
  - 输出目录: ${result.outputDir}
  - baseline: ${result.comparison.baseline.score} 分
  - variant: ${result.comparison.variant.score} 分
  - 自动判断: ${result.comparison.winner}
  - 人工结论模板: ${join(result.outputDir, "conclusion.md")}
`);
} finally {
  await shutdownAppResources();
}

export async function runArticleQualityExperiment(cliOptions: CliOptions) {
  const baseConfig = await getAppConfig();
  const stores = createLocalArticleRuntimeStores(baseConfig);
  const runtimeConfig = await resolveArticleRuntimeConfig(
    stores.runtimeConfigStore,
    baseConfig,
    cliOptions.profileId,
  );
  const config = forceDryRun(runtimeConfig.config);
  const experimentId = cliOptions.experimentId ??
    `article-quality-${new Date().toISOString().replaceAll(":", "-")}`;
  const outputRoot = cliOptions.outputDir ??
    config.storage.artifacts.outputDir ??
    "src/temp";
  const experimentOutputRoot = join(outputRoot, "experiments", experimentId);
  const outputDir = join(Deno.cwd(), experimentOutputRoot);
  await Deno.mkdir(outputDir, { recursive: true });

  const options: ArticleQualityExperimentOptions = {
    experimentId,
    outputDir: experimentOutputRoot,
    profileId: runtimeConfig.profile.id,
    sourceType: cliOptions.sourceType,
    maxArticles: cliOptions.maxArticles,
    maxResearchQueries: cliOptions.maxResearchQueries,
    maxResultsPerQuery: cliOptions.maxResultsPerQuery,
    maxRevisionRounds: cliOptions.maxRevisionRounds,
    hypothesis: cliOptions.hypothesis,
  };

  await writeText(outputDir, "hypothesis.md", renderHypothesis(options));

  const dependencies = await createLocalWeixinArticleDependencies(config, {
    outputDir: experimentOutputRoot,
    profileId: runtimeConfig.profile.id,
    runtimeConfigSnapshot: runtimeConfig.snapshot,
  });
  dependencies.renderService.setUploadContentImages(false);

  const input = await prepareExperimentInput(
    config,
    dependencies,
    options,
  );
  await writeJson(outputDir, "input-snapshot.json", input.snapshot);

  const baseline = await renderBranch({
    name: "baseline",
    contents: structuredClone(input.processedContents),
    dependencies,
    topicReport: input.snapshot.topicReport,
    editorialDecision: input.snapshot.editorialDecision,
    maxRevisionRounds: config.features.article.qualityGate.maxRevisionRounds,
  });
  await writeText(outputDir, "baseline.html", baseline.html);

  const research = new ArticleQualityResearchService(
    new ArticleFetchRouter(config),
    {
      maxResearchQueries: options.maxResearchQueries,
      maxResultsPerQuery: options.maxResultsPerQuery,
      searchProviders: resolveExperimentSearchProviders(config),
    },
  );
  const evidencePack = await research.createEvidencePack({
    topicReport: input.snapshot.topicReport,
    editorialDecision: input.snapshot.editorialDecision,
    contents: structuredClone(input.processedContents),
  });
  await writeJson(outputDir, "evidence-pack.json", evidencePack);

  const variantContents = [
    ...structuredClone(input.processedContents),
    ...research.toEvidenceContents(evidencePack),
  ];
  const variant = await renderBranch({
    name: "variant",
    contents: structuredClone(input.processedContents),
    planningContents: variantContents,
    dependencies,
    topicReport: input.snapshot.topicReport,
    editorialDecision: input.snapshot.editorialDecision,
    maxRevisionRounds: Math.min(1, options.maxRevisionRounds),
  });
  await writeText(outputDir, "variant.html", variant.html);

  const comparison = new ArticleQualityExperimentEvaluator().compare(
    baseline,
    variant,
  );
  await writeJson(outputDir, "quality-scores.json", comparison);
  await writeText(
    outputDir,
    "conclusion.md",
    renderConclusion({
      options,
      comparison,
      evidencePack,
      baseline,
      variant,
    }),
  );

  return {
    experimentId,
    outputDir,
    comparison,
    evidencePack,
  };
}

async function prepareExperimentInput(
  config: ResolvedTrendPublishConfig,
  dependencies: WeixinArticleDependencies,
  options: ArticleQualityExperimentOptions,
): Promise<{
  snapshot: ArticleQualityExperimentSnapshot;
  processedContents: ScrapedContent[];
}> {
  const sources = await dependencies.scrapeService.loadSources(
    options.sourceType as ArticleSourceFilter | undefined,
  );
  const scraped = await dependencies.scrapeService.scrapeAllDetailed(sources);
  if (!scraped.contents.length) {
    throw new Error("文章质量实验未获取到任何候选内容");
  }

  const uniqueContents = await dependencies.dedupService.deduplicate(
    scraped.contents,
  );
  const memory = await dependencies.runtime.editorialMemoryStore.getContext({
    profileId: options.profileId,
    recentLimit: 10,
    sourceLimit: 25,
  });
  const topicReport = await dependencies.editorialTopicService
    .createTopicReport(uniqueContents, memory);
  const ranked = (await dependencies.contentRanker.rankContents(uniqueContents))
    .toSorted((left, right) => right.score - left.score);
  if (!ranked.length) {
    throw new Error("文章质量实验排序结果为空");
  }
  const editorialDecision = await dependencies.editorialDecisionService
    .createEditorialDecision(topicReport, uniqueContents, memory);
  const processedContents = await dependencies.processService.processTopRanked(
    ranked,
    uniqueContents,
    options.maxArticles,
    { topicReport, editorialDecision },
  );

  return {
    processedContents: structuredClone(processedContents),
    snapshot: {
      experimentId: options.experimentId,
      generatedAt: new Date().toISOString(),
      profileId: options.profileId,
      config: createSafeConfigSnapshot(config),
      sources,
      sourceHealth: scraped.health,
      counts: {
        scraped: scraped.contents.length,
        unique: uniqueContents.length,
        ranked: ranked.length,
        processed: processedContents.length,
      },
      rankedTop: ranked.slice(0, 20),
      topicReport,
      editorialDecision,
      processedContents: processedContents.map((content) => ({
        id: content.id,
        title: content.title,
        url: content.url,
        publishDate: content.publishDate,
        excerpt: content.content.slice(0, 500),
      })),
    },
  };
}

async function renderBranch(input: {
  name: "baseline" | "variant";
  contents: ScrapedContent[];
  planningContents?: ScrapedContent[];
  dependencies: WeixinArticleDependencies;
  topicReport: ArticleQualityExperimentSnapshot["topicReport"];
  editorialDecision: ArticleQualityExperimentSnapshot["editorialDecision"];
  maxRevisionRounds: number;
}): Promise<ArticleQualityExperimentBranch> {
  const articlePlan = await input.dependencies.articlePlanService
    .createArticlePlan(
      input.topicReport,
      input.planningContents ?? input.contents,
      input.editorialDecision,
    );
  let title = input.dependencies.titleService.generateSummaryTitle(
    input.contents,
  );
  let html = await input.dependencies.renderService.render(
    input.dependencies.renderService.toTemplateData(input.contents),
    { articlePlan },
  );
  let review = await reviewBranch(input, title, html, articlePlan);
  let revision: ArticleRevisionResult | undefined;

  const revisionRounds = Math.max(
    0,
    Math.min(2, Math.floor(input.maxRevisionRounds)),
  );
  for (let round = 1; round <= revisionRounds; round++) {
    if (!shouldRevise(review)) break;
    revision = await input.dependencies.revisionService.reviseArticle({
      round,
      title,
      html,
      articlePlan,
      qualityReview: review,
      contents: input.planningContents ?? input.contents,
    });
    if (!revision.applied) break;
    title = revision.title;
    html = revision.html;
    review = await reviewBranch(input, title, html, articlePlan);
  }

  return {
    name: input.name,
    title,
    html,
    articlePlan,
    review,
    revision,
    contents: input.contents,
  };
}

async function reviewBranch(
  input: {
    dependencies: WeixinArticleDependencies;
    topicReport: ArticleQualityExperimentSnapshot["topicReport"];
    contents: ScrapedContent[];
    planningContents?: ScrapedContent[];
  },
  title: string,
  html: string,
  articlePlan: ArticleQualityExperimentBranch["articlePlan"],
): Promise<ArticleQualityReview> {
  return await input.dependencies.qualityReviewService.reviewArticle({
    title,
    html,
    articlePlan,
    topicReport: input.topicReport,
    contents: input.planningContents ?? input.contents,
  });
}

function shouldRevise(review: ArticleQualityReview): boolean {
  if (review.recommendedAction === "publish" && review.overallScore >= 80) {
    return false;
  }
  return review.issues.some((issue) =>
    issue.autoFixable &&
    issue.severity !== "blocker" &&
    !(issue.category === "fact" && issue.severity === "high")
  );
}

function forceDryRun(
  config: ResolvedTrendPublishConfig,
): ResolvedTrendPublishConfig {
  const cloned = structuredClone(config);
  cloned.features.article.dryRun = true;
  cloned.features.article.cover.enabled = false;
  cloned.features.article.bodyImages.mode = "off";
  return cloned;
}

function createSafeConfigSnapshot(config: ResolvedTrendPublishConfig) {
  return {
    article: {
      count: config.features.article.count,
      renderer: config.features.article.renderer,
      sourceLimits: config.features.article.sourceLimits,
      qualityGate: config.features.article.qualityGate,
      sources: config.features.article.sources,
    },
    fetchGroups: config.fetchGroups,
    providers: {
      ai: Boolean(
        config.providers.ai.baseUrl &&
          config.providers.ai.apiKey &&
          config.providers.ai.model,
      ),
      firecrawl: Boolean(config.providers.fetch.firecrawl.apiKey),
      jina: Boolean(config.providers.fetch.jina.apiKey),
      twitter: Boolean(
        config.providers.fetch.twitter.bearerToken ||
          config.providers.fetch.twitter.xquikApiKey,
      ),
      rss: Boolean(config.providers.fetch.rss.baseUrl),
    },
  };
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    maxResearchQueries: 4,
    maxResultsPerQuery: 5,
    maxRevisionRounds: 1,
    hypothesis: DEFAULT_HYPOTHESIS,
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const next = args[index + 1];
    switch (arg) {
      case "article-quality":
        break;
      case "--profile":
        options.profileId = readNext(arg, next);
        index++;
        break;
      case "--source":
        options.sourceType = readSourceFilter(readNext(arg, next));
        index++;
        break;
      case "--max-articles":
        options.maxArticles = readPositiveNumber(arg, next);
        index++;
        break;
      case "--max-queries":
        options.maxResearchQueries = readPositiveNumber(arg, next);
        index++;
        break;
      case "--max-results":
        options.maxResultsPerQuery = readPositiveNumber(arg, next);
        index++;
        break;
      case "--max-revisions":
        options.maxRevisionRounds = readNonNegativeNumber(arg, next);
        index++;
        break;
      case "--output":
        options.outputDir = readNext(arg, next);
        index++;
        break;
      case "--id":
        options.experimentId = readNext(arg, next);
        index++;
        break;
      case "--hypothesis":
        options.hypothesis = readNext(arg, next);
        index++;
        break;
      case "--help":
        printHelp();
        Deno.exit(0);
        break;
      default:
        throw new Error(`未知参数: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`文章质量实验

用法:
  deno task experiment article-quality
  deno task experiment article-quality --max-articles 5 --max-queries 4

参数:
  --config <path>       指定配置文件路径
  --profile <id>        指定 Dashboard 运行时配置 Profile
  --source <type>       限制抓取 provider，例如 all、firecrawl、jina、brave-search、gdelt
  --max-articles <n>    限制参与生成的文章数量
  --max-queries <n>     variant 搜索 query 上限，默认 4
  --max-results <n>     每个 query 搜索结果上限，默认 5
  --max-revisions <n>   variant 自动修订轮次，默认 1，当前最大 1
  --output <dir>        输出根目录，默认 storage.artifacts.outputDir
  --id <id>             指定实验 ID
  --hypothesis <text>   指定本次实验假设
`);
}

function readNext(name: string, value?: string): string {
  if (!value) throw new Error(`${name} 需要提供值`);
  return value;
}

function readPositiveNumber(name: string, value?: string): number {
  const number = Number(readNext(name, value));
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${name} 需要提供正整数`);
  }
  return Math.floor(number);
}

function readNonNegativeNumber(name: string, value?: string): number {
  const number = Number(readNext(name, value));
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${name} 需要提供非负整数`);
  }
  return Math.floor(number);
}

function readSourceFilter(value: string): ArticleSourceFilter {
  if (ARTICLE_SOURCE_FILTERS.has(value as ArticleSourceFilter)) {
    return value as ArticleSourceFilter;
  }
  throw new Error(
    `--source 必须是以下值之一: ${
      Array.from(ARTICLE_SOURCE_FILTERS).join("、")
    }`,
  );
}

const ARTICLE_SOURCE_FILTERS = new Set<ArticleSourceFilter>([
  "all",
  "firecrawl",
  "jina",
  "jina-search",
  "brave-search",
  "tavily-search",
  "exa-search",
  "serper-search",
  "newsapi",
  "gdelt",
  "hackernews",
  "arxiv",
  "twitter",
  "rss",
]);

function resolveExperimentSearchProviders(
  config: ResolvedTrendPublishConfig,
): FetchProviderId[] {
  const providers = resolveSourceProviders(
    "article quality experiment",
    config.fetchGroups.search ?? ["auto"],
    "query",
  ).filter(isSearchFetchProvider);
  return providers.filter((provider) =>
    fetchProviderRegistry.get(provider).isConfigured(config)
  ) as FetchProviderId[];
}

async function writeJson(
  outputDir: string,
  filename: string,
  value: unknown,
): Promise<void> {
  await writeText(outputDir, filename, JSON.stringify(value, null, 2));
}

async function writeText(
  outputDir: string,
  filename: string,
  value: string,
): Promise<void> {
  await Deno.writeTextFile(join(outputDir, filename), value);
}
