import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { EditorialDecision } from "@src/features/weixin-article/domain/editorial-decision.ts";
import type { EditorialTopicReport } from "@src/features/weixin-article/domain/editorial-topic.ts";
import type {
  EvidenceItem,
  EvidencePack,
  EvidenceSourceType,
} from "@src/features/weixin-article/domain/evidence.ts";
import type {
  ArticleContentFetcher,
  ArticleContentFetchFailure,
} from "@src/features/weixin-article/services/content-scrape.service.ts";
import { Logger } from "@zilla/logger";

const logger = new Logger("weixin-article-research-service");

export interface ArticleResearchConfig {
  enabled: boolean;
  maxResearchQueries: number;
  maxResultsPerQuery: number;
  maxHydrationCandidates?: number;
  searchProviders: string[];
}

export class WeixinArticleResearchService {
  constructor(
    private readonly contentFetcher: ArticleContentFetcher,
    private readonly config: ArticleResearchConfig,
  ) {}

  async createEvidencePack(input: {
    topicReport: EditorialTopicReport;
    editorialDecision: EditorialDecision;
    contents: ScrapedContent[];
  }): Promise<EvidencePack> {
    const topic = input.editorialDecision.leadTopicTitle ||
      input.topicReport.clusters[0]?.title ||
      "未命名选题";

    if (!this.config.enabled) {
      return createEmptyEvidencePack(topic, "未配置搜索能力，跳过补充证据");
    }

    const queries = this.createQueries(input).slice(
      0,
      normalizeLimit(this.config.maxResearchQueries, 3, 6),
    );
    const resultLimit = normalizeLimit(this.config.maxResultsPerQuery, 3, 8);
    const maxHydrationCandidates = normalizeLimit(
      this.config.maxHydrationCandidates ?? 3,
      3,
      6,
    );
    const globalSignals = buildResearchSignals(input, topic);
    let hydrationAttempts = 0;
    const items: EvidenceItem[] = [];
    const gaps: string[] = [];
    const seenUrls = new Set<string>();

    for (const query of queries) {
      const failures: ArticleContentFetchFailure[] = [];
      const querySignals = [
        ...new Set([...globalSignals, ...tokenizeResearchSignal(query)]),
      ];
      try {
        const result = await this.contentFetcher.scrape(
          {
            raw: `search:${query}`,
            url: query,
            kind: "query",
            group: "search",
            providers: this.config.searchProviders,
          },
          (failure) => {
            failures.push(failure);
          },
        );
        const candidates = result.contents
          .filter((candidate) => isUsableEvidenceCandidate(candidate))
          .filter((candidate) =>
            isRelevantEvidenceCandidate(candidate, querySignals)
          )
          .slice(0, resultLimit);
        if (!candidates.length) {
          gaps.push(`搜索无相关结果: ${query}`);
          continue;
        }

        for (const candidate of candidates) {
          if (seenUrls.has(candidate.url)) continue;
          seenUrls.add(candidate.url);

          const shouldHydrate = hydrationAttempts < maxHydrationCandidates &&
            shouldHydrateEvidenceCandidate(candidate);
          const evidenceContent = shouldHydrate
            ? await this.hydrateCandidate(candidate)
            : candidate;
          if (shouldHydrate) hydrationAttempts += 1;
          if (!isRelevantEvidenceCandidate(evidenceContent, querySignals)) {
            gaps.push(`搜索结果深抓后相关性不足: ${evidenceContent.url}`);
            continue;
          }
          items.push(this.toEvidenceItem(evidenceContent, querySignals));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failureMessage = failures.length
          ? `${message}; ${
            failures.map((item) => `${item.provider}: ${item.message}`).join(
              "; ",
            )
          }`
          : message;
        logger.warn(`[补充研究] 搜索失败: ${query} - ${failureMessage}`);
        gaps.push(`搜索失败: ${query} - ${failureMessage}`);
      }
    }

    const filteredItems = filterEvidenceItems(items);
    return {
      topic,
      generatedAt: new Date().toISOString(),
      queries,
      items: filteredItems.slice(0, queries.length * resultLimit),
      gaps,
      skippedReason: filteredItems.length ? undefined : "未获得可用补充证据",
    };
  }

  private createQueries(input: {
    topicReport: EditorialTopicReport;
    editorialDecision: EditorialDecision;
    contents: ScrapedContent[];
  }): string[] {
    const clusterTitleById = new Map(
      input.topicReport.clusters.map((cluster) => [cluster.id, cluster.title]),
    );
    const sourceHosts = [
      ...new Set(
        input.contents.map((content) => readHost(content.url)).filter(
          Boolean,
        ),
      ),
    ].slice(0, 3);
    const leadTopicTitle = input.editorialDecision.leadTopicTitle;
    const values = [
      leadTopicTitle,
      `${leadTopicTitle} ${
        sourceHosts.length ? sourceHosts.join(" ") : "official announcement"
      }`,
      ...input.editorialDecision.selectedTopics.map((topic) =>
        clusterTitleById.get(topic.topicId)
      ),
      ...input.topicReport.clusters.flatMap((cluster) => [
        cluster.title,
        cluster.keywords.slice(0, 3).join(" "),
      ]),
      ...input.contents.slice(0, 3).map((content) =>
        `${content.title} ${sourceHosts[0] ?? ""}`
      ),
    ];

    const seen = new Set<string>();
    return values
      .map((value) => value?.replace(/\s+/g, " ").trim())
      .filter((value): value is string => Boolean(value && value.length >= 2))
      .filter((value) => {
        const key = value.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  private async hydrateCandidate(
    candidate: ScrapedContent,
  ): Promise<ScrapedContent> {
    if (!this.contentFetcher.hydrate) return candidate;
    try {
      const result = await this.contentFetcher.hydrate(candidate, (failure) => {
        logger.debug(
          `[补充研究] 证据深抓失败 ${candidate.url}: ${failure.provider} ${failure.message}`,
        );
      });
      return result.content;
    } catch (error) {
      logger.debug(
        `[补充研究] 证据深抓异常 ${candidate.url}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return candidate;
    }
  }

  private toEvidenceItem(
    content: ScrapedContent,
    querySignals: string[],
  ): EvidenceItem {
    const sourceType = inferSourceType(content.url, querySignals);
    const supportSignals = findMatchedSignals(content, querySignals);
    return {
      id: `ev_${stableHash(`${querySignals.join(" ")}:${content.url}`)}`,
      title: content.title || content.url,
      url: content.url,
      provider: String(
        content.metadata.provider ?? content.metadata.source ?? "unknown",
      ),
      sourceType,
      summary: normalizeSummary(content.content),
      supports: supportSignals.length
        ? supportSignals.slice(0, 8)
        : ["与本次选题存在弱相关，需人工复核"],
      confidence: inferConfidence(sourceType),
    };
  }
}

function createEmptyEvidencePack(
  topic: string,
  skippedReason: string,
): EvidencePack {
  return {
    topic,
    generatedAt: new Date().toISOString(),
    queries: [],
    items: [],
    gaps: [],
    skippedReason,
  };
}

function inferSourceType(
  url: string,
  querySignals: string[] = [],
): EvidenceSourceType {
  const host = readHost(url);
  if (!host) return "background";
  if (
    host.includes("github.com") && !isFirstPartyGithubUrl(url, querySignals)
  ) {
    return "community";
  }
  if (
    host.endsWith(".gov") ||
    host.endsWith(".edu") ||
    host.includes("openai.com") ||
    host.includes("anthropic.com") ||
    host.includes("deepmind.google") ||
    host.includes("research.google") ||
    host.includes("blog.google") ||
    host.includes("googleblog.com") ||
    host.includes("microsoft.com") ||
    host.includes("github.com")
  ) {
    return "official";
  }
  if (
    host.includes("arxiv.org") ||
    host.includes("paperswithcode.com") ||
    host.includes("huggingface.co") ||
    host.includes("pmc.ncbi.nlm.nih.gov")
  ) {
    return "primary";
  }
  if (
    host.includes("x.com") ||
    host.includes("twitter.com") ||
    host.includes("reddit.com") ||
    host.includes("news.ycombinator.com")
  ) {
    return "community";
  }
  if (
    host.includes("techcrunch.com") ||
    host.includes("theverge.com") ||
    host.includes("wired.com") ||
    host.includes("36kr.com") ||
    host.includes("qbitai.com")
  ) {
    return "media";
  }
  return "background";
}

function inferConfidence(sourceType: EvidenceSourceType): EvidenceItem[
  "confidence"
] {
  if (sourceType === "official" || sourceType === "primary") return "high";
  if (sourceType === "media" || sourceType === "community") return "medium";
  return "low";
}

function filterEvidenceItems(items: EvidenceItem[]): EvidenceItem[] {
  return items.filter((item) => {
    if (item.summary.trim().length < 120) return false;
    if (item.supports.length === 1 && item.supports[0].includes("弱相关")) {
      return false;
    }
    if (item.confidence === "low" && item.sourceType === "background") {
      return false;
    }
    return true;
  });
}

function isUsableEvidenceCandidate(content: ScrapedContent): boolean {
  const host = readHost(content.url);
  if (!host) return false;
  if (
    noisyEvidenceHosts.some((blocked) =>
      host === blocked || host.endsWith(`.${blocked}`)
    )
  ) {
    return false;
  }

  const sourceType = inferSourceType(content.url);
  if (sourceType !== "background") return true;
  return normalizeSummary(content.content).length >= 500;
}

function isRelevantEvidenceCandidate(
  content: ScrapedContent,
  querySignals: string[],
): boolean {
  if (!querySignals.length) return true;
  const matched = findMatchedSignals(content, querySignals);
  if (matched.length >= 2) return true;

  const host = readHost(content.url) ?? "";
  const officialHostMatch = officialHostSignalRules.some((rule) =>
    host.includes(rule.host) &&
    rule.signals.some((signal) => querySignals.includes(signal))
  );
  return officialHostMatch && matched.length >= 1;
}

function findMatchedSignals(
  content: ScrapedContent,
  querySignals: string[],
): string[] {
  const textSignals = tokenizeResearchSignal(
    `${content.title}\n${content.url}\n${content.content}`,
  );
  const textSet = new Set(textSignals);
  return [...new Set(querySignals.filter((signal) => textSet.has(signal)))];
}

function shouldHydrateEvidenceCandidate(content: ScrapedContent): boolean {
  const sourceType = inferSourceType(content.url);
  if (sourceType === "background" || sourceType === "community") return false;
  if (normalizeSummary(content.content).length >= 500) return false;
  return true;
}

function normalizeSummary(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 900);
}

function buildResearchSignals(
  input: {
    topicReport: EditorialTopicReport;
    editorialDecision: EditorialDecision;
    contents: ScrapedContent[];
  },
  topic: string,
): string[] {
  const clusterById = new Map(
    input.topicReport.clusters.map((cluster) => [cluster.id, cluster]),
  );
  const values = [
    topic,
    input.editorialDecision.leadTopicTitle,
    input.editorialDecision.decisionSummary,
    ...input.editorialDecision.whyThisNow,
    ...input.editorialDecision.selectedTopics.flatMap((selected) => {
      const cluster = clusterById.get(selected.topicId);
      return [
        selected.reason,
        cluster?.title,
        cluster?.summary,
        ...(cluster?.keywords ?? []),
      ];
    }),
    ...input.contents.slice(0, 5).flatMap((content) => [
      content.title,
      ...(Array.isArray(content.metadata.keywords)
        ? content.metadata.keywords.filter((item): item is string =>
          typeof item === "string"
        )
        : []),
    ]),
  ];
  return [...new Set(values.flatMap(tokenizeResearchSignal))].slice(0, 80);
}

function tokenizeResearchSignal(value: string | undefined): string[] {
  if (!value) return [];
  const normalized = expandDomainSynonyms(value.toLowerCase());
  const baseTokens = normalized
    .replace(/[^\p{L}\p{N}.+-]+/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const tokens = baseTokens.flatMap((token) => {
    if (/^\p{Script=Han}+$/u.test(token)) {
      return createCjkSignalTokens(token);
    }
    return [token];
  });
  return [
    ...new Set(
      tokens
        .map((token) => token.replace(/^\.+|\.+$/g, ""))
        .filter((token) => token.length >= 2)
        .filter((token) => !genericResearchTokens.has(token)),
    ),
  ];
}

function expandDomainSynonyms(value: string): string {
  let result = value;
  for (const [pattern, expansion] of domainSynonyms) {
    if (pattern.test(result)) {
      result = `${result} ${expansion}`;
    }
  }
  return result;
}

function createCjkSignalTokens(value: string): string[] {
  if (value.length <= 4) return [value];
  const tokens = new Set<string>();
  for (const size of [2, 3, 4]) {
    for (let index = 0; index <= value.length - size; index += 1) {
      tokens.add(value.slice(index, index + size));
    }
  }
  return [...tokens];
}

function readHost(value: string): string | undefined {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function isFirstPartyGithubUrl(url: string, querySignals: string[]): boolean {
  try {
    const pathParts = new URL(url).pathname.toLowerCase().split("/").filter(
      Boolean,
    );
    const owner = pathParts[0];
    if (!owner) return false;
    return githubOwnerSignalRules.some((rule) =>
      rule.owners.includes(owner) &&
      rule.signals.some((signal) => querySignals.includes(signal))
    );
  } catch {
    return false;
  }
}

const officialHostSignalRules = [
  { host: "openai.com", signals: ["openai", "codex", "gpt"] },
  { host: "anthropic.com", signals: ["anthropic", "claude", "opus"] },
  { host: "deepmind.google", signals: ["deepmind", "gemini", "gemma"] },
  { host: "blog.google", signals: ["google", "gemini", "gemma"] },
  { host: "microsoft.com", signals: ["microsoft", "azure"] },
];

const githubOwnerSignalRules = [
  { owners: ["openai"], signals: ["openai", "codex", "gpt"] },
  { owners: ["anthropics", "anthropic-ai"], signals: ["anthropic", "claude"] },
  {
    owners: ["google", "google-deepmind", "deepmind"],
    signals: ["google", "gemini", "gemma"],
  },
  { owners: ["microsoft"], signals: ["microsoft", "azure"] },
];

const domainSynonyms: Array<[RegExp, string]> = [
  [/前沿治理框架|治理框架/u, "frontier governance framework"],
  [/可信第三方|第三方评估/u, "trustworthy third party evaluations"],
  [/合规自查|安全评估/u, "safety evaluations compliance"],
  [/税务(?:agent|智能体)|tax\s*agent/u, "tax agents"],
  [/混合云|本地部署|企业部署/u, "hybrid on-premises enterprise environments"],
  [/编码智能体|编程助手/u, "coding agents"],
  [/上下文窗口/u, "context window"],
  [/定价/u, "pricing"],
];

const genericResearchTokens = new Set([
  "ai",
  "api",
  "www",
  "com",
  "http",
  "https",
  "news",
  "blog",
  "official",
  "announcement",
  "update",
  "updates",
  "model",
  "models",
  "product",
  "products",
  "company",
  "companies",
  "enterprise",
  "enterprises",
  "technology",
  "technologies",
  "agent",
  "agents",
  "发布",
  "更新",
  "官方",
  "企业",
  "模型",
  "技术",
  "产品",
  "文章",
  "主线",
  "现在",
  "可以",
  "什么",
  "这个",
  "一个",
  "几个",
  "分析",
  "深度",
  "今日",
  "本期",
  "工程",
  "落地",
]);

function normalizeLimit(value: number, fallback: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function stableHash(value: string): string {
  let result = 0;
  for (let index = 0; index < value.length; index++) {
    result = ((result << 5) - result + value.charCodeAt(index)) | 0;
  }
  return Math.abs(result).toString(36);
}

const noisyEvidenceHosts = [
  "zhihu.com",
  "zhuanlan.zhihu.com",
  "weixin.qq.com",
  "mp.weixin.qq.com",
  "baijiahao.baidu.com",
  "csdn.net",
  "juejin.cn",
  "toutiao.com",
  "sina.com.cn",
  "finance.sina.com.cn",
  "youtube.com",
  "youtu.be",
  "instagram.com",
  "facebook.com",
  "linkedin.com",
  "bilibili.com",
];
