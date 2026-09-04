import { assertEquals } from "@std/assert";
import {
  defineConfig,
  resolveTrendPublishConfig,
  resolveWeixinPublishAccount,
} from "@src/utils/config/define-config.ts";

Deno.test("resolveTrendPublishConfig returns typed resolved config", () => {
  const config = resolveTrendPublishConfig(defineConfig({
    server: { apiKey: "server-key" },
    providers: {
      ai: {
        baseUrl: "https://example.com/v1",
        apiKey: "llm-key",
        model: "model",
        timeoutMs: 240000,
        maxAttempts: 3,
      },
      fetch: {
        firecrawl: { apiKey: "firecrawl-key" },
        twitter: { xquikApiKey: "xquik-key" },
      },
      image: {
        dashscope: {
          apiKey: "dashscope-key",
        },
        minimax: {
          apiKey: "minimax-key",
          apiHost: "https://api.minimax.io",
        },
      },
      notify: {
        bark: { url: "https://example.com/bark" },
        dingtalk: { webhook: "https://example.com/dingtalk" },
      },
      vector: {
        embedding: {
          baseUrl: "https://embedding.example.com/v1",
          apiKey: "embedding-key",
          model: "text-embedding-v3",
        },
      },
    },
    fetchGroups: {
      default: ["auto"],
      web: ["firecrawl", "jina"],
    },
    features: {
      article: {
        publisher: {
          provider: "weixin",
        },
        renderer: {
          template: "dynamic",
          promptProfile: "business",
        },
        count: 8,
        dryRun: true,
        notifications: {
          channels: ["bark", "dingtalk"],
        },
        sources: ["web:https://example.com"],
        bodyImages: {
          mode: "missing",
          provider: "minimax",
          count: 1,
          size: "1024*1024",
        },
        deduplication: {
          enabled: true,
          embeddingProvider: "dashscope",
          vectorStore: "sqlite",
        },
        sourceLimits: {
          maxAgeDays: 7,
          maxItemsPerSource: 12,
        },
        qualityGate: {
          enabled: true,
          minScore: 85,
          blockOnHighFactIssue: true,
          forcePublish: true,
          allowForcePublish: false,
          maxRevisionRounds: 2,
        },
      },
    },
    storage: {
      vector: {
        provider: "sqlite",
        sqlitePath: "src/temp/test.sqlite3",
      },
    },
  }));

  assertEquals(config.server.apiKey, "server-key");
  assertEquals(config.providers.ai.model, "model");
  assertEquals(config.providers.ai.timeoutMs, 240000);
  assertEquals(config.providers.ai.maxAttempts, 3);
  assertEquals(config.features.article.publisher.provider, "weixin");
  assertEquals(config.features.article.publisher.accountId, "");
  assertEquals(config.features.article.renderer.template, "dynamic");
  assertEquals(config.features.article.renderer.promptProfile, "business");
  assertEquals(config.features.article.count, 8);
  assertEquals(config.features.article.dryRun, true);
  assertEquals(config.features.article.sources, ["web:https://example.com"]);
  assertEquals(config.fetchGroups.web, ["firecrawl", "jina"]);
  assertEquals(config.providers.fetch.firecrawl.apiKey, "firecrawl-key");
  assertEquals(config.providers.fetch.twitter.xquikApiKey, "xquik-key");
  assertEquals(config.providers.image.dashscope.apiKey, "dashscope-key");
  assertEquals(config.providers.image.minimax.apiKey, "minimax-key");
  assertEquals(config.features.article.bodyImages.mode, "missing");
  assertEquals(config.features.article.bodyImages.provider, "minimax");
  assertEquals(config.features.article.bodyImages.model, "image-01");
  assertEquals(config.features.article.deduplication.enabled, true);
  assertEquals(
    config.features.article.deduplication.embeddingProvider,
    "dashscope",
  );
  assertEquals(config.features.article.deduplication.vectorStore, "sqlite");
  assertEquals(config.features.article.sourceLimits.maxAgeDays, 7);
  assertEquals(config.features.article.sourceLimits.maxItemsPerSource, 12);
  assertEquals(config.features.article.qualityGate.enabled, true);
  assertEquals(config.features.article.qualityGate.minScore, 85);
  assertEquals(config.features.article.qualityGate.forcePublish, true);
  assertEquals(config.features.article.qualityGate.allowForcePublish, false);
  assertEquals(config.features.article.qualityGate.maxRevisionRounds, 2);
  assertEquals(config.storage.vector.provider, "sqlite");
  assertEquals(config.storage.vector.sqlitePath, "src/temp/test.sqlite3");
  assertEquals(config.features.article.notifications.channels, [
    "bark",
    "dingtalk",
  ]);
  assertEquals(config.providers.notify.bark.url, "https://example.com/bark");
  assertEquals(
    config.providers.notify.dingtalk.webhook,
    "https://example.com/dingtalk",
  );
});

Deno.test("resolveTrendPublishConfig supports multiple weixin publish accounts", () => {
  const config = resolveTrendPublishConfig(defineConfig({
    providers: {
      publish: {
        weixin: {
          author: "Default Author",
          accounts: {
            main: {
              appId: "main-app",
              appSecret: "main-secret",
            },
            lab: {
              appId: "lab-app",
              appSecret: "lab-secret",
              author: "Lab Author",
              needOpenComment: false,
            },
          },
        },
      },
    },
    features: {
      article: {
        publisher: {
          provider: "weixin-relay",
          accountId: "lab",
        },
      },
    },
  }));

  assertEquals(config.features.article.publisher.accountId, "lab");
  assertEquals(
    config.providers.publish.weixin.accounts.main.author,
    "Default Author",
  );
  assertEquals(
    config.providers.publish.weixin.accounts.lab.author,
    "Lab Author",
  );
  assertEquals(
    config.providers.publish.weixin.accounts.lab.needOpenComment,
    false,
  );
  const account = resolveWeixinPublishAccount(
    config.providers.publish.weixin,
    config.features.article.publisher.accountId,
  );
  assertEquals(account?.accountId, "lab");
  assertEquals(account?.account.appId, "lab-app");
});

Deno.test("resolveTrendPublishConfig uses feature defaults without provider enablement", () => {
  const config = resolveTrendPublishConfig(defineConfig({}));

  assertEquals(config.features.article.renderer.template, "minimal");
  assertEquals(config.features.article.renderer.promptProfile, "technology");
  assertEquals(config.features.article.deduplication.enabled, false);
  assertEquals(config.features.article.deduplication.vectorStore, "sqlite");
  assertEquals(config.features.article.qualityGate.enabled, true);
  assertEquals(config.features.article.qualityGate.minScore, 80);
  assertEquals(config.features.article.qualityGate.blockOnHighFactIssue, true);
  assertEquals(config.features.article.qualityGate.forcePublish, false);
  assertEquals(config.features.article.qualityGate.allowForcePublish, true);
  assertEquals(config.features.article.qualityGate.maxRevisionRounds, 1);
  assertEquals(config.features.article.sourceLimits.maxAgeDays, 14);
  assertEquals(config.features.article.sourceLimits.maxItemsPerSource, 20);
  assertEquals(config.features.article.notifications.channels, []);
  assertEquals(config.providers.vector.embedding.model, "");
  assertEquals(config.providers.notify.bark.url, "");
});
