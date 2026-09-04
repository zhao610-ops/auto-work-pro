// 这个示例可以放在项目根目录，也可以复制到 config/trendpublish.config.ts。
import { defineConfig } from "@src/utils/config/define-config.ts";

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export default defineConfig((runtime) => ({
  server: {
    apiKey: runtime.required("SERVER_API_KEY"),
    port: 8000,
  },

  providers: {
    ai: {
      baseUrl: runtime.value("AI_BASE_URL", "https://api.deepseek.com/v1"),
      apiKey: runtime.required("AI_API_KEY"),
      model: runtime.value("AI_MODEL", "deepseek-chat"),
    },
    fetch: {
      firecrawl: {
        apiKey: runtime.secret("FIRECRAWL_API_KEY"),
      },
      jina: {
        apiKey: runtime.secret("JINA_API_KEY"),
      },
      twitter: {
        bearerToken: runtime.secret("TWITTER_BEARER_TOKEN"),
        xquikApiKey: runtime.secret("XQUIK_API_KEY"),
      },
      rss: {
        baseUrl: runtime.value("RSSHUB_BASE_URL", "https://rsshub.app"),
      },
    },
    image: {
      dashscope: {
        apiKey: runtime.secret("DASHSCOPE_API_KEY"),
      },
    },
    publish: {
      weixin: {
        appId: runtime.secret("WEIXIN_APP_ID"),
        appSecret: runtime.secret("WEIXIN_APP_SECRET"),
        author: runtime.value("WEIXIN_AUTHOR", "AI Trend Publish"),
        // 多公众号时可在这里配置 accounts，并用 WEIXIN_ACCOUNT_ID 选择。
        accounts: {},
      },
      weixinRelay: {
        // relay 只保存自己的 API key；微信 appId/appSecret 仍由当前配置透传。
        url: runtime.secret("WEIXIN_RELAY_URL"),
        token: runtime.secret("WEIXIN_RELAY_TOKEN"),
      },
    },
  },

  fetchGroups: {
    default: ["auto"],
    web: ["firecrawl", "jina"],
    social: ["twitter"],
  },

  features: {
    article: {
      sources: splitList(
        runtime.value("ARTICLE_SOURCES", "https://news.ycombinator.com/"),
      ),
      publisher: {
        provider: runtime.value("WEIXIN_PUBLISH_PROVIDER", "weixin") as
          | "weixin"
          | "weixin-relay",
        accountId: runtime.value("WEIXIN_ACCOUNT_ID", ""),
      },
      renderer: {
        template: "dynamic",
        promptProfile: "technology",
      },
      count: Number(runtime.value("ARTICLE_COUNT", "10")),
      dryRun: true,
      notifications: {
        channels: [],
      },
      cover: {
        enabled: false,
        provider: "dashscope",
        model: "wanx-poster-generation-v1",
      },
      bodyImages: {
        mode: "off",
        provider: "dashscope",
        count: 1,
        size: "1024*1024",
      },
      deduplication: {
        enabled: false,
        embeddingProvider: "dashscope",
        vectorStore: "sqlite",
      },
    },
  },

  storage: {
    artifacts: {
      provider: "local",
      outputDir: "src/temp",
    },
    runState: {
      provider: "local-json",
      outputDir: "src/temp",
    },
    vector: {
      provider: "sqlite",
      sqlitePath: "src/temp/trendpublish.sqlite3",
    },
  },
}));
