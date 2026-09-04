import {
  initializeAppConfig,
  parseConfigArgs,
} from "@src/utils/config/app-config.ts";
import type { ResolvedTrendPublishConfig } from "@src/utils/config/define-config.ts";

interface SyncArgs {
  envFile?: string;
  dryRun: boolean;
}

const { configPath, args } = parseConfigArgs(Deno.args);
const options = parseSyncArgs(args);
const config = await initializeAppConfig({ configPath });
await syncSecrets(config, options);

async function syncSecrets(
  config: ResolvedTrendPublishConfig,
  options: SyncArgs,
): Promise<void> {
  const secrets = collectSecrets(config);
  if (secrets.length === 0) {
    console.log("没有可同步的 Cloudflare secrets。");
    return;
  }

  console.log(
    `准备同步 ${secrets.length} 个 Cloudflare secrets: ${
      secrets.map(([name]) => name).join(", ")
    }`,
  );

  for (const [name, value] of secrets) {
    if (options.dryRun) {
      console.log(`[dry-run] ${name}`);
      continue;
    }
    await putSecret(name, value, options);
    console.log(`已同步 ${name}`);
  }
}

function collectSecrets(
  config: ResolvedTrendPublishConfig,
): Array<[string, string]> {
  const article = config.features.article;
  const providers = config.providers;
  const pairs: Array<[string, unknown]> = [
    ["SERVER_API_KEY", config.server.apiKey],
    ["AI_BASE_URL", providers.ai.baseUrl],
    ["AI_API_KEY", providers.ai.apiKey],
    ["AI_MODEL", providers.ai.model],
    ["AI_TIMEOUT_MS", providers.ai.timeoutMs],
    ["AI_MAX_ATTEMPTS", providers.ai.maxAttempts],
    ["ARTICLE_SOURCES", article.sources.join(",")],
    ["ARTICLE_COUNT", String(article.count)],
    ["ARTICLE_RENDERER_TEMPLATE", article.renderer.template],
    ["ARTICLE_PROMPT_PROFILE", article.renderer.promptProfile],
    ["WEIXIN_PUBLISH_PROVIDER", article.publisher.provider],
    ["WEIXIN_ACCOUNT_ID", article.publisher.accountId],
    ["FIRECRAWL_API_KEY", providers.fetch.firecrawl?.apiKey],
    ["JINA_API_KEY", providers.fetch.jina?.apiKey],
    ["BRAVE_SEARCH_API_KEY", providers.fetch.brave?.apiKey],
    ["TAVILY_API_KEY", providers.fetch.tavily?.apiKey],
    ["EXA_API_KEY", providers.fetch.exa?.apiKey],
    ["SERPER_API_KEY", providers.fetch.serper?.apiKey],
    ["NEWSAPI_API_KEY", providers.fetch.newsapi?.apiKey],
    ["TWITTER_BEARER_TOKEN", providers.fetch.twitter?.bearerToken],
    ["XQUIK_API_KEY", providers.fetch.twitter?.xquikApiKey],
    ["RSSHUB_BASE_URL", providers.fetch.rss?.baseUrl],
    ["DASHSCOPE_API_KEY", providers.image.dashscope?.apiKey],
    ["MINIMAX_API_KEY", providers.image.minimax?.apiKey],
    ["MINIMAX_API_HOST", providers.image.minimax?.apiHost],
    ["COVER_ENABLED", String(article.cover.enabled)],
    ["COVER_PROVIDER", article.cover.provider],
    ["COVER_MODEL", article.cover.model],
    ["BODY_IMAGES_MODE", article.bodyImages.mode],
    ["BODY_IMAGES_PROVIDER", article.bodyImages.provider],
    ["BODY_IMAGES_MODEL", article.bodyImages.model],
    ["BODY_IMAGES_COUNT", String(article.bodyImages.count)],
    ["BODY_IMAGES_SIZE", article.bodyImages.size],
    ["WEIXIN_APP_ID", providers.publish.weixin?.appId],
    ["WEIXIN_APP_SECRET", providers.publish.weixin?.appSecret],
    ["WEIXIN_RELAY_URL", providers.publish.weixinRelay?.url],
    ["WEIXIN_RELAY_TOKEN", providers.publish.weixinRelay?.token],
    ["WEIXIN_AUTHOR", providers.publish.weixin?.author],
    [
      "WEIXIN_NEED_OPEN_COMMENT",
      String(providers.publish.weixin?.needOpenComment ?? true),
    ],
    [
      "WEIXIN_ONLY_FANS_CAN_COMMENT",
      String(providers.publish.weixin?.onlyFansCanComment ?? false),
    ],
    ["NOTIFICATION_CHANNELS", article.notifications.channels.join(",")],
    ["BARK_URL", providers.notify.bark?.url],
    ["DINGTALK_WEBHOOK", providers.notify.dingtalk?.webhook],
    ["FEISHU_WEBHOOK_URL", providers.notify.feishu?.webhookUrl],
  ];

  return pairs
    .map(([name, value]) =>
      [name, String(value ?? "").trim()] as [
        string,
        string,
      ]
    )
    .filter(([, value]) => value.length > 0);
}

async function putSecret(
  name: string,
  value: string,
  options: SyncArgs,
): Promise<void> {
  const args = ["run", "-A", "npm:wrangler"];
  if (options.envFile) {
    args.push("--env-file", options.envFile);
  }
  args.push("secret", "put", name);

  const child = new Deno.Command(Deno.execPath(), {
    args,
    stdin: "piped",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();

  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(`${value}\n`));
  await writer.close();

  const status = await child.status;
  if (!status.success) {
    throw new Error(`同步 Cloudflare secret 失败: ${name}`);
  }
}

function parseSyncArgs(args: string[]): SyncArgs {
  let envFile: string | undefined;
  let dryRun = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--env-file") {
      envFile = args[++index];
      continue;
    }
    if (arg.startsWith("--env-file=")) {
      envFile = arg.slice("--env-file=".length);
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
    }
  }
  return { envFile, dryRun };
}
