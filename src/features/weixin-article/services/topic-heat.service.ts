import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type {
  EditorialTopicReport,
  TopicCluster,
  TopicScore,
} from "@src/features/weixin-article/domain/editorial-topic.ts";

/**
 * 主题热度服务：默认只使用本地可解释信号；生产依赖可打开 GDELT，作为
 * “今天正在发生什么”的额外验证。外部服务失败绝不阻塞当日工作流。
 */
export class TopicHeatService {
  constructor(
    private readonly options: {
      enableExternal?: boolean;
      fetchFn?: typeof fetch;
      now?: () => Date;
    } = {},
  ) {}

  async enrich(
    report: EditorialTopicReport,
    contents: ScrapedContent[],
  ): Promise<EditorialTopicReport> {
    const contentById = new Map(contents.map((item) => [item.id, item]));
    await Promise.all(report.scores.map(async (score) => {
      const cluster = report.clusters.find((item) => item.id === score.topicId);
      if (!cluster) return;
      const localHeat = calculateLocalHeat(cluster, contentById, this.now());
      const globalImpact = calculateGlobalImpact(cluster, contentById);
      const externalHeat = this.options.enableExternal
        ? await this.readGdeltHeat(cluster)
        : undefined;
      score.heat = externalHeat === undefined
        ? round(localHeat * 0.6 + globalImpact * 0.4)
        : round(localHeat * 0.35 + globalImpact * 0.3 + externalHeat * 0.35);
      applyBusinessLeadGate(score);
    }));
    report.scores.sort((left, right) => right.finalScore - left.finalScore);
    return report;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private async readGdeltHeat(
    cluster: TopicCluster,
  ): Promise<number | undefined> {
    const terms = [cluster.title, ...cluster.keywords]
      .map((item) => item.trim())
      .filter((item) => item.length >= 2)
      .slice(0, 4);
    if (!terms.length) return undefined;
    const query = terms.join(" OR ");
    const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
    url.searchParams.set("query", query);
    url.searchParams.set("mode", "timelinevolraw");
    url.searchParams.set("format", "json");
    url.searchParams.set("timespan", "1d");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4_000);
    try {
      const response = await (this.options.fetchFn ?? fetch)(url, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) return undefined;
      const payload = await response.json() as {
        timeline?: Array<{ data?: Array<{ value?: number }> }>;
      };
      const volume = payload.timeline?.[0]?.data?.reduce(
        (total, item) => total + (Number(item.value) || 0),
        0,
      ) ?? 0;
      return volume > 0 ? round(Math.min(100, Math.log10(volume + 1) * 35)) : 0;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function applyBusinessLeadGate(score: TopicScore): void {
  const heat = score.heat ?? 50;
  score.businessValue = round(
    score.actionability * 0.45 + score.evidence * 0.35 + score.relevance * 0.20,
  );
  const eligible = score.relevance >= 55 && score.evidence >= 50 &&
    score.actionability >= 55 && score.risk < 75;
  score.eligibleForLead = eligible;
  score.eligibilityReason = eligible
    ? "已满足目标人群相关性、证据与可落地性门槛。"
    : "未满足主线准入：需要同时具备目标人群相关性、可靠证据与可复用抓手。";
  const weighted = heat * 0.30 + score.businessValue * 0.25 +
    score.evidence * 0.20 + score.relevance * 0.15 + score.novelty * 0.10;
  score.finalScore = round(
    Math.max(
      0,
      Math.min(100, weighted - score.risk * 0.08 - score.saturation * 0.05),
    ),
  );
  if (!eligible) {
    score.finalScore = Math.min(score.finalScore, 39);
    score.recommendedUse = "skip";
  } else if (score.finalScore >= 70) {
    score.recommendedUse = "lead";
  } else if (score.recommendedUse === "lead") {
    score.recommendedUse = "brief";
  }
}

function calculateLocalHeat(
  cluster: TopicCluster,
  contentById: Map<string, ScrapedContent>,
  now: Date,
): number {
  const articles = cluster.articleIds
    .map((id) => contentById.get(id))
    .filter((item): item is ScrapedContent => Boolean(item));
  const domains = new Set(
    articles.map((item) => hostname(item.url)).filter(Boolean),
  );
  const freshest = articles.reduce(
    (best, item) => Math.max(best, recency(item.publishDate, now)),
    0,
  );
  const sourceSignal = Math.min(
    100,
    (Math.max(cluster.sourceCount, domains.size) - 1) * 28 + 35,
  );
  return round(freshest * 0.55 + sourceSignal * 0.45);
}

function calculateGlobalImpact(
  cluster: TopicCluster,
  contentById: Map<string, ScrapedContent>,
): number {
  const text = [
    cluster.title,
    ...cluster.keywords,
    ...cluster.articleIds.map((id) => {
      const item = contentById.get(id);
      return item ? `${item.title} ${item.url}` : "";
    }),
  ].join(" ").toLowerCase();
  const macro = countMatches(text, [
    "federal reserve",
    "fed",
    "ecb",
    "european union",
    "g7",
    "imf",
    "world bank",
    "inflation",
    "interest rate",
    "employment",
    "tariff",
    "trade",
    "energy",
    "supply chain",
    "united states",
    "japan",
    "india",
    "south korea",
    "eurozone",
  ]);
  const technology = countMatches(text, [
    "artificial intelligence",
    " ai ",
    "semiconductor",
    "chip",
    "cloud",
    "robot",
    "automation",
    "data center",
    "energy storage",
    "electric vehicle",
  ]);
  const companies = countMatches(text, [
    "apple",
    "microsoft",
    "google",
    "alphabet",
    "amazon",
    "meta",
    "nvidia",
    "tesla",
    "openai",
    "tsmc",
    "samsung",
    "asml",
    "toyota",
    "walmart",
  ]);
  const independentSources = new Set(
    cluster.articleIds.map((id) => contentById.get(id)).filter(Boolean)
      .map((item) => hostname(item!.url)).filter(Boolean),
  ).size;
  return Math.min(
    100,
    macro * 19 + technology * 17 + companies * 18 +
      Math.min(3, independentSources) * 12,
  );
}

function countMatches(text: string, terms: string[]): number {
  return terms.reduce(
    (count, term) => count + (text.includes(term) ? 1 : 0),
    0,
  );
}

function recency(value: string, now: Date): number {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return 30;
  const hours = (now.getTime() - time) / 3_600_000;
  if (hours <= 6) return 100;
  if (hours <= 24) return 85;
  if (hours <= 72) return 65;
  if (hours <= 168) return 42;
  return 20;
}

function hostname(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
