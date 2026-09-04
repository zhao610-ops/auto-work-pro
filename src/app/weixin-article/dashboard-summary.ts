import {
  hasAnyResolvedWeixinAccount,
  type ResolvedTrendPublishConfig,
} from "@src/utils/config/define-config.ts";

export interface DashboardConfigSummary {
  mode: "local" | "cloudflare-workflow";
  article: {
    dryRunDefault: boolean;
    count: number;
    sourcesCount: number;
    renderer: {
      template: string;
      promptProfile: string;
    };
    publisher: {
      provider: string;
      accountId: string;
    };
    cover: {
      enabled: boolean;
      provider: string;
      model: string;
    };
    bodyImages: {
      mode: string;
      provider: string;
      model: string;
      count: number;
      size: string;
    };
    deduplication: {
      enabled: boolean;
      embeddingProvider: string;
      vectorStore: string;
    };
    notifications: {
      channels: string[];
    };
    qualityGate: {
      enabled: boolean;
      minScore: number;
      blockOnHighFactIssue: boolean;
      forcePublish: boolean;
      allowForcePublish: boolean;
      maxRevisionRounds: number;
    };
  };
  storage: {
    artifacts: string;
    runState: string;
    runtimeConfig: string;
    vector: string;
  };
  fetchGroups: string[];
  providersConfigured: Record<string, boolean>;
  observability: {
    enabled: boolean;
    sinks: string[];
  };
}

export function createDashboardConfigSummary(
  config: ResolvedTrendPublishConfig,
  mode: DashboardConfigSummary["mode"],
): DashboardConfigSummary {
  const article = config.features.article;
  return {
    mode,
    article: {
      dryRunDefault: article.dryRun,
      count: article.count,
      sourcesCount: article.sources.length,
      renderer: {
        template: article.renderer.template,
        promptProfile: article.renderer.promptProfile,
      },
      publisher: {
        provider: article.publisher.provider,
        accountId: article.publisher.accountId,
      },
      cover: {
        enabled: article.cover.enabled,
        provider: article.cover.provider,
        model: article.cover.model,
      },
      bodyImages: {
        mode: article.bodyImages.mode,
        provider: article.bodyImages.provider,
        model: article.bodyImages.model,
        count: article.bodyImages.count,
        size: article.bodyImages.size,
      },
      deduplication: {
        enabled: article.deduplication.enabled,
        embeddingProvider: article.deduplication.embeddingProvider,
        vectorStore: article.deduplication.vectorStore,
      },
      notifications: {
        channels: article.notifications.channels,
      },
      qualityGate: {
        enabled: article.qualityGate.enabled,
        minScore: article.qualityGate.minScore,
        blockOnHighFactIssue: article.qualityGate.blockOnHighFactIssue,
        forcePublish: article.qualityGate.forcePublish,
        allowForcePublish: article.qualityGate.allowForcePublish,
        maxRevisionRounds: article.qualityGate.maxRevisionRounds,
      },
    },
    storage: {
      artifacts: config.storage.artifacts.provider,
      runState: config.storage.runState.provider,
      runtimeConfig: config.storage.runtimeConfig.provider,
      vector: config.storage.vector.provider,
    },
    fetchGroups: Object.keys(config.fetchGroups),
    providersConfigured: {
      ai: Boolean(config.providers.ai.apiKey),
      firecrawl: Boolean(config.providers.fetch.firecrawl.apiKey),
      jina: Boolean(config.providers.fetch.jina.apiKey),
      jinaSearch: Boolean(config.providers.fetch.jina.apiKey),
      braveSearch: Boolean(config.providers.fetch.brave.apiKey),
      tavilySearch: Boolean(config.providers.fetch.tavily.apiKey),
      exaSearch: Boolean(config.providers.fetch.exa.apiKey),
      serperSearch: Boolean(config.providers.fetch.serper.apiKey),
      newsapi: Boolean(config.providers.fetch.newsapi.apiKey),
      gdelt: true,
      hackernews: true,
      arxiv: true,
      twitter: Boolean(
        config.providers.fetch.twitter.bearerToken ||
          config.providers.fetch.twitter.xquikApiKey,
      ),
      rss: Boolean(config.providers.fetch.rss.baseUrl),
      dashscopeImage: Boolean(config.providers.image.dashscope.apiKey),
      minimaxImage: Boolean(config.providers.image.minimax.apiKey),
      weixin: hasAnyResolvedWeixinAccount(config.providers.publish.weixin),
      weixinRelay: Boolean(
        config.providers.publish.weixinRelay.url &&
          config.providers.publish.weixinRelay.token,
      ),
      embedding: Boolean(config.providers.vector.embedding.apiKey),
      bark: Boolean(config.providers.notify.bark.url),
      dingtalk: Boolean(config.providers.notify.dingtalk.webhook),
      feishu: Boolean(config.providers.notify.feishu.webhookUrl),
    },
    observability: {
      enabled: config.observability.enabled,
      sinks: [
        config.observability.stdout.enabled ? "stdout" : "",
        config.observability.http.enabled ? "http" : "",
        config.observability.axiom.enabled ? "axiom" : "",
        config.observability.betterStack.enabled ? "better-stack" : "",
      ].filter(Boolean),
    },
  };
}
