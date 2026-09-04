import {
  initializeAppConfig,
  parseConfigArgs,
} from "@src/utils/config/app-config.ts";
import { WeixinPublisher } from "@src/integrations/publish/providers/weixin-publisher.ts";
import {
  type ResolvedTrendPublishConfig,
  type ResolvedWeixinPublishAccountConfig,
} from "@src/utils/config/define-config.ts";
import type { PublishArticleRequest } from "@src/core/ports/content-publisher.ts";
import { redactSensitiveText } from "@src/utils/security/redact.ts";
import { Logger } from "@zilla/logger";

const logger = new Logger("weixin-relay");
const { configPath } = parseConfigArgs(Deno.args);
const config = await initializeAppConfig({ configPath });
assertRelayConfig(config);
const port = Number(Deno.env.get("PORT") ?? config.server.port ?? 8080);

logger.info(`Weixin relay listening on http://0.0.0.0:${port}`);
logger.info("Weixin relay mode: credential-passthrough");

Deno.serve({ port }, async (request) => {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return json({
      ok: true,
      service: "weixin-relay",
      mode: "credential-passthrough",
      timestamp: new Date().toISOString(),
    });
  }

  const unauthorized = await verifyAuth(request);
  if (unauthorized) return unauthorized;

  try {
    if (
      request.method === "POST" && url.pathname === "/api/weixin/validate-ip"
    ) {
      const { account } = await readRelayRequest<Record<string, never>>(
        request,
      );
      const publisher = createPublisher(account);
      const result = await publisher.validateIpWhitelist();
      return ok({ result });
    }

    if (
      request.method === "POST" && url.pathname === "/api/weixin/upload-image"
    ) {
      const { account, payload } = await readRelayRequest<
        { imageUrl?: string }
      >(
        request,
      );
      const publisher = createPublisher(account);
      const mediaId = await publisher.uploadImage(payload.imageUrl ?? "");
      return ok({ mediaId });
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/weixin/upload-content-image"
    ) {
      const { account, payload } = await readRelayRequest<
        {
          imageUrl?: string;
          imageBufferBase64?: string;
        }
      >(request);
      const publisher = createPublisher(account);
      const imageUrl = payload.imageUrl ?? "";
      const imageBuffer = payload.imageBufferBase64
        ? base64ToBytes(payload.imageBufferBase64)
        : undefined;
      const uploadedUrl = await publisher.uploadContentImage(
        imageUrl,
        imageBuffer,
      );
      return ok({ url: uploadedUrl });
    }

    if (request.method === "POST" && url.pathname === "/api/weixin/publish") {
      const { account, payload } = await readRelayRequest<
        PublishArticleRequest
      >(
        request,
      );
      const publisher = createPublisher(account);
      const result = await publisher.publishArticle({
        content: payload.content,
        title: payload.title,
        digest: payload.digest,
        coverMediaId: payload.coverMediaId,
      });
      return ok(result);
    }

    return json({ success: false, error: "Not Found" }, { status: 404 });
  } catch (error) {
    const message = redactSensitiveText(
      error instanceof Error ? error.message : String(error),
    );
    logger.error("Relay request failed:", message);
    return json({ success: false, error: message }, { status: 500 });
  }
});

async function verifyAuth(request: Request): Promise<Response | null> {
  const expected = config.server.apiKey;
  const authHeader = request.headers.get("Authorization");
  const provided = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  if (!expected || !provided || !await timingSafeEqual(provided, expected)) {
    return json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const leftDigest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", left),
  );
  const rightDigest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", right),
  );
  let diff = left.byteLength === right.byteLength ? 0 : 1;
  for (let index = 0; index < leftDigest.length; index++) {
    diff |= leftDigest[index] ^ rightDigest[index];
  }
  return diff === 0;
}

async function readJson<T>(request: Request): Promise<T> {
  const text = await request.text();
  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}

function ok<T>(data: T): Response {
  return json({ success: true, data });
}

function json(value: unknown, init: ResponseInit = {}): Response {
  return Response.json(value, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...init.headers,
    },
  });
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

interface RelayAccountRequest {
  account?: Partial<ResolvedWeixinPublishAccountConfig> & {
    accountId?: string;
  };
}

interface RelayRequest<T> extends RelayAccountRequest {
  payload?: T;
}

interface ResolvedRelayAccount extends ResolvedWeixinPublishAccountConfig {
  accountId: string;
}

async function readRelayRequest<T>(
  request: Request,
): Promise<{ account: ResolvedRelayAccount; payload: T }> {
  const body = await readJson<RelayRequest<T>>(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("weixin-relay 请求体必须是 { account, payload }");
  }
  return {
    account: resolveRelayAccount(body.account),
    payload: (body.payload ?? {}) as T,
  };
}

function resolveRelayAccount(
  input: RelayAccountRequest["account"],
): ResolvedRelayAccount {
  const accountId = input?.accountId?.trim() || "default";
  assertAccountId(accountId);
  const appId = input?.appId?.trim() ?? "";
  const appSecret = input?.appSecret?.trim() ?? "";
  assertConfigured("account.appId", appId);
  assertConfigured("account.appSecret", appSecret);
  return {
    accountId,
    appId,
    appSecret,
    author: input?.author?.trim() || "AI Trend Publish",
    needOpenComment: typeof input?.needOpenComment === "boolean"
      ? input.needOpenComment
      : true,
    onlyFansCanComment: typeof input?.onlyFansCanComment === "boolean"
      ? input.onlyFansCanComment
      : false,
  };
}

function createPublisher(account: ResolvedRelayAccount): WeixinPublisher {
  const providerAccount = {
    appId: account.appId,
    appSecret: account.appSecret,
    author: account.author,
    needOpenComment: account.needOpenComment,
    onlyFansCanComment: account.onlyFansCanComment,
  };
  const provider: ResolvedTrendPublishConfig["providers"]["publish"][
    "weixin"
  ] = account.accountId === "default"
    ? {
      ...providerAccount,
      accounts: {},
    }
    : {
      appId: "",
      appSecret: "",
      author: providerAccount.author,
      needOpenComment: providerAccount.needOpenComment,
      onlyFansCanComment: providerAccount.onlyFansCanComment,
      accounts: {
        [account.accountId]: providerAccount,
      },
    };
  return new WeixinPublisher(
    provider,
    account.accountId === "default" ? undefined : account.accountId,
  );
}

function assertRelayConfig(config: ResolvedTrendPublishConfig): void {
  assertConfigured("server.apiKey", config.server.apiKey);
}

function assertAccountId(accountId: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(accountId)) {
    throw new Error(`weixin-relay 公众号账号 ID 不合法: ${accountId}`);
  }
}

function assertConfigured(name: string, value: string): void {
  const normalized = value.trim().toLowerCase();
  if (
    !normalized ||
    normalized.includes("change-me") ||
    normalized.includes("your-") ||
    normalized.includes("your_")
  ) {
    throw new Error(`weixin-relay 配置未填写: ${name}`);
  }
}
