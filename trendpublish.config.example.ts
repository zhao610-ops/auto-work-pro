import { defineConfig } from "@src/utils/config/define-config.ts";

export default defineConfig({
  /**
   * 服务配置。
   *
   * `apiKey` 用于 JSON-RPC 接口鉴权：
   * Authorization: Bearer <apiKey>
   */
  server: {
    apiKey: "change-me",
    port: 8000,
  },

  /**
   * 外部服务凭证。
   *
   * 这里只放凭证和 provider 默认参数。功能是否启用、使用哪个 provider、
   * 使用什么参数，都放在 `features.article` 里。
   */
  providers: {
    /**
     * 全文章链路默认使用的 LLM。
     *
     * 排序、摘要、标题生成、动态模板和 AI 提示词都会使用这组配置。
     * 这里支持任意 OpenAI Chat Completions 兼容接口。
     */
    ai: {
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "",
      model: "deepseek-chat",
      // 长上下文步骤（动态模板、质量审稿）可能需要更久，默认 300 秒。
      timeoutMs: 300000,
      // HTTP 层最大尝试次数。用于抵抗偶发 TLS/网络抖动；模型慢时仍优先提高 timeoutMs。
      maxAttempts: 2,
    },

    /**
     * 内容抓取 provider 凭证。
     *
     * 只需要填写 `fetchGroups` 会用到，或 `auto` 会推断到的 provider。
     * 例如 Twitter/X URL 需要 twitter provider；普通网页默认通常需要
     * FireCrawl，除非你把它路由到 Jina。
     */
    fetch: {
      firecrawl: {
        apiKey: "",
      },
      twitter: {
        bearerToken: "",
        xquikApiKey: "",
      },
      jina: {
        apiKey: "",
      },
      brave: {
        apiKey: "",
      },
      tavily: {
        apiKey: "",
      },
      exa: {
        apiKey: "",
      },
      serper: {
        apiKey: "",
      },
      newsapi: {
        apiKey: "",
      },
      rss: {
        baseUrl: "https://rsshub.app",
      },
    },

    /**
     * 图片生成凭证。
     *
     * 支持阿里云图片生成和 MiniMax 图片生成。
     *
     * 功能里 `provider: "dashscope"` 时读取 dashscope.apiKey；
     * 功能里 `provider: "minimax"` 时读取 minimax.apiKey。
     */
    image: {
      dashscope: {
        apiKey: "",
      },
      minimax: {
        apiKey: "",
        apiHost: "https://api.minimax.io",
      },
    },

    /**
     * 发布凭证。
     *
     * 只有 `features.article.dryRun` 为 false，也就是真正发布到公众号时才必填。
     */
    publish: {
      weixin: {
        appId: "",
        appSecret: "",
        author: "AI Trend Publish",
        needOpenComment: true,
        onlyFansCanComment: false,
        /**
         * 多公众号矩阵预留。
         *
         * 单公众号可以只填上面的 appId/appSecret。
         * 多公众号时在这里配置多个账号，再在
         * features.article.publisher.accountId 里选择本次发布目标。
         */
        accounts: {
          // main: {
          //   appId: "",
          //   appSecret: "",
          //   author: "AI Trend Publish",
          // },
          // lab: {
          //   appId: "",
          //   appSecret: "",
          //   author: "AI Lab",
          // },
        },
      },
      /**
       * Cloudflare Worker 没有固定出口 IP。真实发布建议让 Cloudflare 调用
       * 固定 IP 机器上的 weixin-relay。
       *
       * relay 只保存自己的 API key，不保存公众号凭证；主服务会把本次发布
       * 选择的微信 appId/appSecret 随请求透传给 relay。
       */
      weixinRelay: {
        url: "",
        token: "",
      },
    },

    /**
     * 通知凭证。
     *
     * 在这里填写 webhook 不会自动开启通知。是否开启通知由
     * `features.article.notifications.channels` 决定。
     */
    notify: {
      bark: {
        url: "",
      },
      dingtalk: {
        webhook: "",
      },
      feishu: {
        webhookUrl: "",
      },
    },

    /**
     * 文章去重使用的 embedding 凭证。
     *
     * 是否启用去重由 `features.article.deduplication.enabled` 决定。
     */
    vector: {
      embedding: {
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "",
        model: "text-embedding-v3",
      },
    },
  },

  /**
   * 抓取路由分组。
   *
   * `sources` 里的数据源可以是普通 URL，也可以带分组前缀：
   * - "https://example.com" 使用 `default` 分组
   * - "web:https://example.com" 使用 `web` 分组
   * - "search:AI agent news" 使用 `search` 分组做关键词搜索
   *
   * 分组里的 provider 会按顺序 fallback。谁先返回内容，就使用谁的结果。
   * `auto` 会按 URL 自动推断 provider：
   * - x.com / twitter.com -> twitter
   * - RSS / RSSHub / feed URL -> rss
   * - 其他网页 -> firecrawl
   *
   * `search` 是关键词发现能力。优先配置低成本搜索 provider；
   * `gdelt`、`hackernews`、`arxiv` 不需要 API Key，适合免费补充新闻、社区和论文线索。
   */
  fetchGroups: {
    default: ["auto"],
    web: ["firecrawl", "jina"],
    social: ["twitter"],
    rss: ["rss"],
    search: ["gdelt", "hackernews", "arxiv"],
    paidSearch: [
      "brave-search",
      "jina-search",
      "tavily-search",
      "exa-search",
      "serper-search",
    ],
    reliableWeb: ["firecrawl", "jina"],
    freeResearch: ["gdelt", "hackernews", "arxiv"],
  },

  /**
   * 功能配置。
   *
   * 当前项目主流程聚焦微信公众号文章发布。
   */
  features: {
    article: {
      /**
       * 文章数据源列表。
       *
       * 新手可以先只写普通 URL。只有某个数据源需要指定抓取策略时，
       * 再添加 `group:url` 前缀。
       */
      sources: [
        "https://news.ycombinator.com/",
        "web:https://example.com/ai-news",
        "social:https://x.com/OpenAIDevs",
        "reliableWeb:https://openai.com/news/",
        "reliableWeb:https://www.anthropic.com/news",
        "reliableWeb:https://blog.google/technology/ai/",
        "reliableWeb:https://deepmind.google/discover/blog/",
        "reliableWeb:https://ai.meta.com/blog/",
        "search:AI agent research breakthrough latest",
        "rss:https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
        "rss:https://huggingface.co/blog/feed.xml",
      ],

      /**
       * 发布 provider 选择。
       *
       * - 本地/Docker 固定 IP 直连微信：`weixin`
       * - Cloudflare 等无固定出口 IP 环境：`weixin-relay`
       */
      publisher: {
        provider: "weixin",
        // 多公众号发布目标。默认账号留空；使用 accounts 时填写 "main"、"lab" 等 accountId。
        accountId: "",
      },

      /**
       * 微信文章渲染配置。
       *
       * `template` 控制视觉模板。使用 `dynamic` 时，AI 会根据本次文章列表
       * 实时生成微信兼容的内联 HTML。
       *
       * `promptProfile` 控制内容口径，会统一影响排序、摘要、标题、动态排版、
       * 封面提示词和正文配图提示词。
       */
      renderer: {
        template: "dynamic",
        promptProfile: "technology",
      },

      /**
       * 每次发布保留多少篇排序后的文章。
       */
      count: 10,

      /**
       * 安全本地模式。
       *
       * true: 只生成 HTML artifact，不上传图片、不发布到公众号。
       * 本地/Docker 会写入 `src/temp`，Cloudflare 会写入 R2。
       * false: 上传图片并发布 / 创建微信公众号草稿。
       */
      dryRun: true,

      /**
       * 工作流通知。
       *
       * 留空表示关闭通知。需要开启时，在 channels 中加入渠道名，并配置
       * 对应 `providers.notify.*` 凭证：
       * ["bark"]、["dingtalk"]、["feishu"]，也可以组合多个渠道。
       */
      notifications: {
        channels: [],
      },

      /**
       * 封面图生成。
       *
       * provider 可选：
       * - "dashscope": 阿里云图片生成，例如 qwen-image-2.0-pro
       * - "minimax": MiniMax 图片生成，例如 image-01
       *
       * 如果 provider 未配置或生成失败，流程会回退到内置默认封面。
       */
      cover: {
        enabled: true,
        provider: "dashscope",
        model: "qwen-image-2.0-pro",
      },

      /**
       * 正文 AI 配图。
       *
       * mode:
       * - "off": 不生成正文配图。
       * - "missing": 只给没有抓取到原文图片的文章补图。
       * - "all": 每篇文章都尝试生成正文配图。
       */
      bodyImages: {
        mode: "off",
        provider: "dashscope",
        model: "qwen-image-2.0",
        count: 1,
        size: "1024*1024",
      },

      /**
       * 文章向量去重。
       *
       * 开启后会计算文章 embedding，并和历史向量做相似度对比。
       * 本地/Docker 默认使用 SQLite，Cloudflare 原生模式使用 D1。
       * SQLite 会自动执行内置建表 SQL；Cloudflare D1 使用 migrations 目录。
       */
      deduplication: {
        enabled: false,
        embeddingProvider: "dashscope",
        vectorStore: "sqlite",
      },

      /**
       * 数据源截断。
       *
       * 所有抓取 provider 都统一生效：普通网页、RSS、Twitter 都会先过滤旧内容，
       * 再限制每个源进入选题/排序的数量，避免历史内容或超大 RSS 源拖垮质量。
       */
      sourceLimits: {
        maxAgeDays: 14,
        maxItemsPerSource: 20,
      },

      /**
       * 发布前质量门禁。
       *
       * 第一性原则：不要把低质量文章发出去。
       * dry-run 永远不会被阻断，方便你观察选题、文章计划、HTML 和审稿结果。
       * 只有 dryRun=false 的真实发布会被门禁保护。
       * 如果你希望生产环境“不达标也先发到草稿箱”，可以把 forcePublish 改为 true；
       * 审稿和修订 artifact 仍会保留，方便事后复盘。
       */
      qualityGate: {
        enabled: true,
        minScore: 80,
        blockOnHighFactIssue: true,
        forcePublish: false,
        allowForcePublish: true,
        maxRevisionRounds: 1,
      },
    },
  },

  /**
   * 业务数据和运行产物存储。
   *
   * artifact/runState 支撑内置看板和 dry-run 产物。
   * runtimeConfig 保存 Dashboard 可编辑的业务配置，本地/Docker 用 SQLite，
   * Cloudflare 用 D1。密钥不会写入 runtimeConfig。
   */
  storage: {
    artifacts: {
      provider: "local",
      outputDir: "src/temp",
    },
    runState: {
      provider: "local-json",
      outputDir: "src/temp",
    },
    runtimeConfig: {
      provider: "sqlite",
      sqlitePath: "src/temp/trendpublish.sqlite3",
    },
    vector: {
      provider: "sqlite",
      sqlitePath: "src/temp/trendpublish.sqlite3",
    },
  },

  /**
   * logger 观测镜像。
   *
   * 所有 `new Logger(...).info/warn/error/debug` 输出都会进入这里配置的 sink。
   * 原 logger 仍会正常输出；stdout sink 会额外输出一份结构化 JSON。
   * 接 Axiom / Better Stack / 自建 collector 时，开启 http sink。
   */
  observability: {
    enabled: true,
    serviceName: "trendpublish",
    environment: "local",
    stdout: {
      enabled: false,
      format: "json",
    },
    http: {
      enabled: false,
      endpoint: "",
      bearerToken: "",
      headers: {},
      format: "object",
      timeoutMs: 5000,
    },
    axiom: {
      enabled: false,
      dataset: "",
      token: "",
      apiUrl: "https://api.axiom.co",
      timeoutMs: 5000,
    },
    betterStack: {
      enabled: false,
      sourceToken: "",
      ingestingHost: "https://in.logs.betterstack.com",
      timeoutMs: 5000,
    },
  },
});
