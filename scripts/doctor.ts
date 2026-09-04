import { existsSync } from "node:fs";
import { planArticleSources } from "@src/app/weixin-article/fetch/article-fetch-planner.ts";
import { ImageGeneratorType } from "@src/core/ports/image-generator.ts";
import { EmbeddingProviderType } from "@src/core/ports/embedding.ts";
import { imageGeneratorRegistry } from "@src/integrations/image/image-generator-registry.ts";
import { llmProviderRegistry } from "@src/integrations/llm/llm-provider-registry.ts";
import { embeddingProviderRegistry } from "@src/integrations/vector/embedding-provider-registry.ts";
import {
  getAppConfig,
  initializeAppConfig,
  parseConfigArgs,
} from "@src/utils/config/app-config.ts";
import {
  ArticleNotificationChannel,
  ResolvedTrendPublishConfig,
  resolveWeixinPublishAccount,
} from "@src/utils/config/define-config.ts";

type CheckStatus = "pass" | "warn" | "fail";

interface CheckResult {
  status: CheckStatus;
  group: string;
  name: string;
  detail: string;
}

const PLACEHOLDER_VALUES = new Set([
  "change-me",
  "your_api_key",
  "your-api-key",
  "your_app_id",
  "your-app-id",
  "your_app_secret",
  "your-app-secret",
  "your_key",
  "your_name",
  "your_webhook_url",
  "your_feishu_webhook_url",
  "your_jina_api_key",
  "password",
]);

const results: CheckResult[] = [];

function add(
  status: CheckStatus,
  group: string,
  name: string,
  detail: string,
) {
  results.push({ status, group, name, detail });
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  const text = String(value).trim();
  return text.length > 0 && !PLACEHOLDER_VALUES.has(text);
}

function checkDenoVersion() {
  const version = Deno.version.deno;
  const major = Number(version.split(".")[0]);
  add(
    major >= 2 ? "pass" : "fail",
    "运行环境",
    "Deno",
    major >= 2
      ? `当前版本 ${version}`
      : `当前版本 ${version}，需要 v2.0.0 或更高版本`,
  );
}

function checkFiles(configPath?: string) {
  const runtime = Deno.env.get("TRENDPUBLISH_RUNTIME");
  const actualConfigPath = configPath ?? Deno.env.get("TRENDPUBLISH_CONFIG") ??
    "trendpublish.config.ts";
  const files = [
    actualConfigPath,
    "src/index.ts",
    "scripts/run.workflow.ts",
    "scripts/print-relay-systemd.ts",
    "scripts/install-relay-systemd.ts",
    "src/app/weixin-article/workflow.definition.ts",
    "src/platform/cloudflare/worker.ts",
    "trendpublish.config.cloudflare.ts",
    "wrangler.jsonc",
    "migrations/0001_article_workflow_state.sql",
    "migrations/0002_runtime_config_center.sql",
    "migrations/0003_weixin_account_matrix.sql",
    "migrations/0004_editorial_memory_account_scope.sql",
    "migrations/0005_weixin_account_ops.sql",
    "migrations/0006_editorial_topic_feedback.sql",
    "src/features/weixin-article/rendering/template-registry.ts",
    "src/features/weixin-article/rendering/templates/article.ejs",
    "src/features/weixin-article/rendering/templates/article.modern.ejs",
    "src/features/weixin-article/rendering/templates/article.tech.ejs",
    "src/features/weixin-article/rendering/templates/article.mianpro.ejs",
    "src/features/weixin-article/rendering/templates/article.minimal.ejs",
    "src/features/weixin-article/rendering/templates/article.longform.ejs",
    "src/features/weixin-article/rendering/templates/article.product.ejs",
    "src/features/weixin-article/rendering/templates/article.darktech.ejs",
  ];

  if (runtime !== "docker") {
    files.push(
      "Dockerfile",
      ".dockerignore",
      "docker-compose.yml",
      "docker-compose.relay.yml",
      "trendpublish.config.docker.example.ts",
      "deploy/systemd/trendpublish-weixin-relay.service",
      ".github/workflows/docker-image.yml",
    );
  }

  for (const file of files) {
    const exists = existsSync(file);
    add(
      exists ? "pass" : "fail",
      "项目文件",
      file,
      exists ? "文件存在" : "文件不存在",
    );
  }

  add(
    existsSync(".env") ? "warn" : "pass",
    "发布体检",
    "旧配置文件",
    existsSync(".env")
      ? "检测到 .env；当前版本只读取 trendpublish.config.ts，请迁移后再发布。"
      : "未检测到旧 .env 文件。",
  );

  add(
    "warn",
    "部署",
    "Cloudflare Worker",
    "Cloudflare 原生模式需要配置 R2(ARTICLE_ARTIFACTS)、KV(ARTICLE_RUNS)、D1(ARTICLE_DB)、Workflow binding 和 secrets；本地 doctor 只做文件和配置结构检查。",
  );
}

function checkRequired(
  group: string,
  name: string,
  fields: [path: string, value: unknown][],
) {
  const missing = fields
    .filter(([, value]) => !hasValue(value))
    .map(([path]) => path);
  add(
    missing.length === 0 ? "pass" : "fail",
    group,
    name,
    missing.length === 0
      ? `已配置: ${fields.map(([path]) => path).join(", ")}`
      : `缺少: ${missing.join(", ")}`,
  );
}

function checkProvider(
  group: string,
  name: string,
  providerConfigured: [configured: boolean, requiredPaths: string[]],
) {
  const [configured, requiredPaths] = providerConfigured;
  add(
    configured ? "pass" : "fail",
    group,
    name,
    configured
      ? `已配置: ${requiredPaths.join(", ")}`
      : `缺少: ${requiredPaths.join(", ")}`,
  );
}

function checkProviderFeature(
  group: string,
  name: string,
  enabled: boolean,
  providerConfigured: boolean,
  requiredPaths: string[],
  detail: string,
) {
  if (!enabled) {
    add("warn", group, name, `未开启。${detail}`);
    return;
  }
  add(
    providerConfigured ? "pass" : "fail",
    group,
    name,
    providerConfigured
      ? `已配置: ${requiredPaths.join(", ")}`
      : `缺少: ${requiredPaths.join(", ")}`,
  );
}

function checkConfig(config: ResolvedTrendPublishConfig) {
  checkRequired("基础必填", "API 鉴权", [
    ["server.apiKey", config.server.apiKey],
  ]);
  checkProvider("基础必填", "LLM", [
    llmProviderRegistry.get("openai-compatible").isConfigured(config),
    [
      "providers.ai.baseUrl",
      "providers.ai.apiKey",
      "providers.ai.model",
    ],
  ]);

  if (config.features.article.publisher.provider === "weixin") {
    const account = resolveWeixinPublishAccount(
      config.providers.publish.weixin,
      config.features.article.publisher.accountId,
    );
    checkRequired(
      "微信发布",
      config.features.article.dryRun
        ? "微信公众号配置(dry-run)"
        : "微信公众号配置",
      config.features.article.dryRun || account ? [] : [
        [
          config.features.article.publisher.accountId
            ? `providers.publish.weixin.accounts.${config.features.article.publisher.accountId}`
            : "providers.publish.weixin.appId/appSecret 或 providers.publish.weixin.accounts",
          "",
        ],
      ],
    );
  } else {
    const account = resolveWeixinPublishAccount(
      config.providers.publish.weixin,
      config.features.article.publisher.accountId,
    );
    const publishRequirements: Array<[string, string]> = [
      [
        "providers.publish.weixinRelay.url",
        config.providers.publish.weixinRelay.url,
      ],
      [
        "providers.publish.weixinRelay.token",
        config.providers.publish.weixinRelay.token,
      ],
    ];
    if (!account) {
      publishRequirements.push([
        config.features.article.publisher.accountId
          ? `providers.publish.weixin.accounts.${config.features.article.publisher.accountId}`
          : "providers.publish.weixin.appId/appSecret 或 providers.publish.weixin.accounts",
        "",
      ]);
    }
    checkRequired(
      "微信发布",
      config.features.article.dryRun
        ? "微信 Relay 配置(dry-run)"
        : "微信 Relay 透传配置",
      config.features.article.dryRun ? [] : publishRequirements,
    );
  }

  add(
    "pass",
    "微信文章",
    "features.article.publisher.provider",
    `当前发布供应商: ${config.features.article.publisher.provider}${
      config.features.article.publisher.accountId
        ? `，账号: ${config.features.article.publisher.accountId}`
        : ""
    }`,
  );
  add(
    "pass",
    "微信文章",
    "features.article.renderer",
    `模板: ${config.features.article.renderer.template}，提示词风格: ${config.features.article.renderer.promptProfile}`,
  );
  add(
    config.features.article.notifications.channels.length > 0 ? "pass" : "warn",
    "微信文章",
    "features.article.notifications.channels",
    config.features.article.notifications.channels.length > 0
      ? `通知渠道: ${config.features.article.notifications.channels.join(", ")}`
      : "未开启通知渠道。",
  );

  checkArticleSources(config);

  checkProviderFeature(
    "封面生图",
    `图片生成 (${config.features.article.cover.provider})`,
    config.features.article.cover.enabled,
    getImageGeneratorCheck(config, "cover").configured,
    getImageGeneratorCheck(config, "cover").requiredPaths,
    "未开启时封面生成会走本地兜底图。",
  );

  checkProviderFeature(
    "正文配图",
    `AI 智能配图 (${config.features.article.bodyImages.provider})`,
    config.features.article.bodyImages.mode !== "off",
    getImageGeneratorCheck(config, "body").configured,
    getImageGeneratorCheck(config, "body").requiredPaths,
    "开启后会按文章内容生成正文配图，失败时回退已有 media 图片布局。",
  );

  const dedupVectorStore = config.features.article.deduplication.vectorStore;
  const dedupUsesSqlite = dedupVectorStore === "sqlite";
  checkProviderFeature(
    "内容去重",
    `向量去重 (${config.features.article.deduplication.embeddingProvider} + ${dedupVectorStore})`,
    config.features.article.deduplication.enabled,
    embeddingProviderRegistry.get(EmbeddingProviderType.DASHSCOPE)
      .isConfigured(config) &&
      (dedupUsesSqlite
        ? hasValue(config.storage.vector.sqlitePath)
        : hasValue(config.storage.vector.d1Binding)),
    dedupUsesSqlite
      ? [
        "providers.vector.embedding.baseUrl",
        "providers.vector.embedding.apiKey",
        "providers.vector.embedding.model",
        "storage.vector.sqlitePath",
      ]
      : [
        "providers.vector.embedding.baseUrl",
        "providers.vector.embedding.apiKey",
        "providers.vector.embedding.model",
        "storage.vector.d1Binding",
      ],
    "开启后会用 embedding 计算相似度，并把向量写入配置的 vector store。",
  );

  add(
    hasValue(config.storage.vector.sqlitePath) ||
      hasValue(config.storage.vector.d1Binding)
      ? "pass"
      : "fail",
    "数据库",
    "向量存储",
    config.storage.vector.provider === "sqlite"
      ? `SQLite: ${config.storage.vector.sqlitePath}`
      : `D1 binding: ${config.storage.vector.d1Binding}`,
  );

  add(
    config.storage.runtimeConfig.provider === "sqlite"
      ? hasValue(config.storage.runtimeConfig.sqlitePath) ? "pass" : "fail"
      : hasValue(config.storage.runtimeConfig.d1Binding)
      ? "pass"
      : "fail",
    "运行时配置",
    "Dashboard 可编辑配置存储",
    config.storage.runtimeConfig.provider === "sqlite"
      ? `SQLite: ${config.storage.runtimeConfig.sqlitePath}`
      : `D1 binding: ${config.storage.runtimeConfig.d1Binding}`,
  );

  checkNotificationChannels(config);
}

function getImageGeneratorCheck(
  config: ResolvedTrendPublishConfig,
  usage: "cover" | "body",
): { configured: boolean; requiredPaths: string[] } {
  const provider = usage === "cover"
    ? config.features.article.cover.provider
    : config.features.article.bodyImages.provider;
  switch (provider) {
    case "dashscope": {
      const type = usage === "cover"
        ? ImageGeneratorType.ALIYUN_POSTER
        : ImageGeneratorType.ALIYUN_IMAGE;
      return {
        configured: imageGeneratorRegistry.get(type).isConfigured(config),
        requiredPaths: ["providers.image.dashscope.apiKey"],
      };
    }
    case "minimax":
      return {
        configured: imageGeneratorRegistry.get(ImageGeneratorType.MINIMAX_IMAGE)
          .isConfigured(config),
        requiredPaths: ["providers.image.minimax.apiKey"],
      };
  }
}

function checkNotificationChannels(config: ResolvedTrendPublishConfig) {
  const channels = new Set(config.features.article.notifications.channels);
  const checks: Record<
    ArticleNotificationChannel,
    { name: string; fields: [path: string, value: unknown][] }
  > = {
    bark: {
      name: "Bark",
      fields: [["providers.notify.bark.url", config.providers.notify.bark.url]],
    },
    dingtalk: {
      name: "钉钉",
      fields: [[
        "providers.notify.dingtalk.webhook",
        config.providers.notify.dingtalk.webhook,
      ]],
    },
    feishu: {
      name: "飞书",
      fields: [[
        "providers.notify.feishu.webhookUrl",
        config.providers.notify.feishu.webhookUrl,
      ]],
    },
  };

  for (const channel of channels) {
    const check = checks[channel];
    checkRequired("通知", check.name, check.fields);
  }
}

function checkArticleSources(config: ResolvedTrendPublishConfig) {
  try {
    const sources = planArticleSources(config);
    add(
      "pass",
      "内容抓取",
      "文章数据源",
      `已配置 ${sources.length} 个数据源，分组: ${
        [...new Set(sources.map((source) => source.group))].join(", ")
      }`,
    );
  } catch (error) {
    add(
      "fail",
      "内容抓取",
      "文章数据源",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function printResults() {
  const icon: Record<CheckStatus, string> = {
    pass: "OK",
    warn: "WARN",
    fail: "FAIL",
  };
  const groupOrder = Array.from(new Set(results.map((result) => result.group)));

  console.log("TrendPublish 配置体检\n");
  for (const group of groupOrder) {
    console.log(`# ${group}`);
    for (const result of results.filter((item) => item.group === group)) {
      console.log(`[${icon[result.status]}] ${result.name} - ${result.detail}`);
    }
    console.log("");
  }

  const failed = results.filter((result) => result.status === "fail").length;
  const warned = results.filter((result) => result.status === "warn").length;
  console.log(`结果: ${failed} 个失败，${warned} 个提醒`);

  if (failed > 0) {
    Deno.exit(1);
  }
}

const parsedConfigArgs = parseConfigArgs(Deno.args);
await initializeAppConfig({ configPath: parsedConfigArgs.configPath });
const config = await getAppConfig();
checkDenoVersion();
checkFiles(parsedConfigArgs.configPath);
checkConfig(config);
printResults();
