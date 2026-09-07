import { triggerWorkflow } from "./controllers/workflow.controller.ts";
import { getAppConfig } from "@src/utils/config/app-config.ts";
import { renderDashboardHtml } from "@src/app/weixin-article/dashboard.html.ts";
import { createDashboardConfigSummary } from "@src/app/weixin-article/dashboard-summary.ts";
import { buildWeixinAccountInsights } from "@src/app/weixin-article/account-insights.ts";
import { createLocalArticleRuntimeStores } from "@src/app/weixin-article/local-runtime-stores.ts";
import { runLocalWeixinArticleMatrixDryRun } from "@src/app/weixin-article/local-matrix-runner.ts";
import { LocalWorkflowRuntime } from "@src/core/workflow/local-workflow-runtime.ts";
import { createLocalWeixinArticleWorkflowDefinition } from "@src/app/weixin-article/local-workflow.definition.ts";
import { handleRuntimeConfigApi } from "@src/app/weixin-article/runtime/runtime-config-api.ts";
import {
  resolveArticleRuntimeConfig,
  seedArticleRuntimeConfig,
} from "@src/app/weixin-article/runtime/article-runtime-config.service.ts";
import type {
  WeixinArticleWorkflowInput,
} from "@src/app/weixin-article/workflow.definition.ts";
import { Logger } from "@zilla/logger";

const logger = new Logger("server");

export interface JSONRPCRequest {
  jsonrpc: string;
  method: string;
  params?: Record<string, unknown>;
  id: string | number;
}

export interface JSONRPCResponse {
  jsonrpc: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
  id: string | number;
}

export class JSONRPCServer {
  private routes: Record<
    string,
    (params: Record<string, unknown>) => Promise<unknown>
  >;

  constructor() {
    this.routes = {};
  }

  registerRoute(
    method: string,
    handler: (params: Record<string, unknown>) => Promise<unknown>,
  ) {
    this.routes[method] = handler;
  }

  async handleRequest(request: Request): Promise<Response> {
    try {
      if (request.method !== "POST") {
        throw new Error("只支持 POST 请求");
      }

      const body = await request.json() as JSONRPCRequest;

      if (!body.jsonrpc || body.jsonrpc !== "2.0") {
        throw new Error("无效的 JSON-RPC 请求");
      }

      if (!body.method) {
        throw new Error("请求缺少方法名");
      }

      const handler = this.routes[body.method];
      if (!handler) {
        throw new Error(`方法 ${body.method} 不存在`);
      }

      const result = await handler(body.params || {});

      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          result,
          id: body.id,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    } catch (error) {
      const isClientError = error instanceof Error && (
        error.message.includes("无效的") ||
        error.message.includes("不存在") ||
        error.message.includes("缺少")
      );

      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: isClientError ? -32600 : -32603,
            message: isClientError ? error.message : "内部服务器错误",
            data: {
              error: error instanceof Error ? error.message : String(error),
            },
          },
          id: "unknown",
        }),
        {
          status: isClientError ? 400 : 500,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }
  }
}

// 创建 JSON-RPC 服务器实例
const rpcServer = new JSONRPCServer();
rpcServer.registerRoute("triggerWorkflow", triggerWorkflow);

async function verifyRequestAuth(req: Request): Promise<Response | null> {
  const API_KEY = (await getAppConfig()).server.apiKey;
  const authHeader = req.headers.get("Authorization");
  if (
    !authHeader || !authHeader.startsWith("Bearer ") ||
    authHeader.split(" ")[1] !== API_KEY
  ) {
    return jsonResponse({
      error: {
        code: -32001,
        message: "未授权的访问",
        data: {
          error: "缺少有效的 Authorization 请求头",
        },
      },
    }, 401);
  }
  return null;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleHealthRequest(req: Request): Promise<Response> {
  const unauthorized = await verifyRequestAuth(req);
  if (unauthorized) return unauthorized;

  const checks: Record<string, { ok: boolean; detail: string }> = {};
  try {
    const config = await getAppConfig();
    checks.config = { ok: true, detail: "trendpublish.config.ts" };
    checks.storage = {
      ok: true,
      detail:
        `${config.storage.artifacts.provider}/${config.storage.runState.provider}/${config.storage.vector.provider}`,
    };
    createLocalArticleRuntimeStores(config);
    checks.runtimeStores = { ok: true, detail: "local runtime stores ready" };
  } catch (error) {
    checks.config = {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const ok = Object.values(checks).every((check) => check.ok);
  return jsonResponse({
    ok,
    mode: "local",
    timestamp: new Date().toISOString(),
    checks,
  }, ok ? 200 : 500);
}

async function handleConfigSummaryRequest(req: Request): Promise<Response> {
  const unauthorized = await verifyRequestAuth(req);
  if (unauthorized) return unauthorized;

  const config = await getAppConfig();
  const stores = createLocalArticleRuntimeStores(config);
  const runtimeConfig = await resolveArticleRuntimeConfig(
    stores.runtimeConfigStore,
    config,
  );
  return jsonResponse(
    createDashboardConfigSummary(runtimeConfig.config, "local"),
  );
}

async function handleAccountInsightsRequest(req: Request): Promise<Response> {
  const unauthorized = await verifyRequestAuth(req);
  if (unauthorized) return unauthorized;

  const config = await getAppConfig();
  const stores = createLocalArticleRuntimeStores(config);
  await seedArticleRuntimeConfig(stores.runtimeConfigStore, config);
  const accounts = await stores.runtimeConfigStore.listWeixinAccountProfiles();
  const runs = await stores.runStateStore.listRuns(500);
  const insights = await buildWeixinAccountInsights({
    accounts,
    runs,
    editorialMemoryStore: stores.editorialMemoryStore,
  });
  return jsonResponse({ insights });
}

async function handleRunsRequest(req: Request, pathname: string) {
  const unauthorized = await verifyRequestAuth(req);
  if (unauthorized) return unauthorized;

  const config = await getAppConfig();
  const stores = createLocalArticleRuntimeStores(config);

  if (req.method === "POST" && pathname === "/api/runs/matrix") {
    const payload = await req.json().catch(() => ({})) as {
      accountIds?: string[];
      profileId?: string;
      dryRun?: boolean;
      sourceType?: WeixinArticleWorkflowInput["sourceType"];
      maxArticles?: number;
    };
    if (payload.dryRun === false) {
      return jsonResponse({ error: "矩阵运行第一版只允许 dry-run" }, 400);
    }
    const accountIds = [...new Set(payload.accountIds ?? [])]
      .filter((id) => typeof id === "string" && id.trim())
      .map((id) => id.trim());
    if (accountIds.length === 0) {
      return jsonResponse({ error: "请选择至少一个公众号账号" }, 400);
    }
    const result = await runLocalWeixinArticleMatrixDryRun(config, stores, {
      accountIds,
      profileId: payload.profileId,
      sourceType: payload.sourceType,
      maxArticles: payload.maxArticles,
    });
    return jsonResponse({
      success: true,
      matrixRunId: result.matrixRunId,
      childRunIds: result.childRunIds,
      status: result.status,
      summary: result.summary,
    });
  }

  if (req.method === "POST" && pathname === "/api/runs") {
    const payload = await req.json().catch(
      () => ({}),
    ) as WeixinArticleWorkflowInput;
    const runId = typeof payload.runId === "string"
      ? payload.runId
      : `manual-${crypto.randomUUID()}`;
    const runtime = new LocalWorkflowRuntime();
    await runtime.run(createLocalWeixinArticleWorkflowDefinition(), {
      payload: {
        ...payload,
        runId,
        trigger: "manual",
      },
      id: runId,
      timestamp: Date.now(),
    });
    return jsonResponse({ success: true, runId });
  }

  if (req.method === "GET" && pathname === "/api/runs") {
    const runs = await stores.runStateStore.listRuns(100);
    return jsonResponse({ runs });
  }

  const feedbackMatch = pathname.match(/^\/api\/runs\/([^/]+)\/feedback$/);
  if (feedbackMatch) {
    const runId = decodeURIComponent(feedbackMatch[1]);
    if (req.method === "GET") {
      const feedback = await stores.editorialMemoryStore.getFeedback(runId);
      return jsonResponse({ feedback });
    }
    if (req.method === "PUT") {
      const payload = await req.json().catch(() => ({})) as {
        rating?: string;
        note?: string;
        profileId?: string;
        accountId?: string;
      };
      const rating = normalizeFeedbackRating(payload.rating);
      if (!rating) {
        return jsonResponse({ error: "rating 必须是 good / ok / bad" }, 400);
      }
      const run = await stores.runStateStore.getRun(runId);
      const feedback = await stores.editorialMemoryStore.saveFeedback({
        runId,
        profileId: typeof payload.profileId === "string"
          ? payload.profileId
          : run?.profileId,
        accountId: typeof payload.accountId === "string"
          ? payload.accountId
          : run?.accountId,
        rating,
        note: typeof payload.note === "string" ? payload.note : undefined,
      });
      return jsonResponse({ feedback });
    }
    if (req.method === "DELETE") {
      const deleted = await stores.editorialMemoryStore.deleteFeedback(runId);
      return jsonResponse({ deleted });
    }
  }

  const topicFeedbackMatch = pathname.match(
    /^\/api\/runs\/([^/]+)\/topic-feedback(?:\/([^/]+))?$/,
  );
  if (topicFeedbackMatch) {
    const runId = decodeURIComponent(topicFeedbackMatch[1]);
    const topicId = topicFeedbackMatch[2]
      ? decodeURIComponent(topicFeedbackMatch[2])
      : undefined;
    if (req.method === "GET") {
      const feedback = await stores.editorialMemoryStore.listTopicFeedback({
        runId,
      });
      return jsonResponse({ feedback });
    }
    if (req.method === "PUT" && topicId) {
      const payload = await req.json().catch(() => ({})) as {
        action?: string;
        title?: string;
        reason?: string;
        profileId?: string;
        accountId?: string;
      };
      const action = normalizeTopicFeedbackAction(payload.action);
      if (!action) {
        return jsonResponse(
          { error: "action 必须是 lead / adopt / skip" },
          400,
        );
      }
      const run = await stores.runStateStore.getRun(runId);
      const feedback = await stores.editorialMemoryStore.saveTopicFeedback({
        runId,
        topicId,
        profileId: typeof payload.profileId === "string"
          ? payload.profileId
          : run?.profileId,
        accountId: typeof payload.accountId === "string"
          ? payload.accountId
          : run?.accountId,
        action,
        title: typeof payload.title === "string" ? payload.title : undefined,
        reason: typeof payload.reason === "string" ? payload.reason : undefined,
      });
      return jsonResponse({ feedback });
    }
    if (req.method === "DELETE" && topicId) {
      const deleted = await stores.editorialMemoryStore.deleteTopicFeedback(
        runId,
        topicId,
      );
      return jsonResponse({ deleted });
    }
  }

  const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (req.method === "GET" && runMatch) {
    const run = await stores.runStateStore.getRun(
      decodeURIComponent(runMatch[1]),
    );
    if (!run) {
      return jsonResponse({ error: "run 不存在" }, 404);
    }
    return jsonResponse({ run });
  }

  return jsonResponse({ error: "无效的 runs API" }, 404);
}

function normalizeFeedbackRating(
  value: string | undefined,
): "good" | "ok" | "bad" | null {
  return value === "good" || value === "ok" || value === "bad" ? value : null;
}

function normalizeTopicFeedbackAction(
  value: string | undefined,
): "lead" | "adopt" | "skip" | null {
  return value === "lead" || value === "adopt" || value === "skip"
    ? value
    : null;
}

async function handleArtifactRequest(req: Request): Promise<Response> {
  const unauthorized = await verifyRequestAuth(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (!key) {
    return jsonResponse({ error: "缺少 key 参数" }, 400);
  }
  const config = await getAppConfig();
  const stores = createLocalArticleRuntimeStores(config);
  const object = await stores.artifactStore.getObject(key);
  if (!object) {
    return jsonResponse({ error: "artifact 不存在" }, 404);
  }
  return new Response(
    toArrayBuffer(object.body),
    {
      headers: {
        "Content-Type": object.ref.contentType,
        "Cache-Control": "no-store",
      },
    },
  );
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  return buffer;
}

async function handleDashboardRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const assetPath = dashboardAssetPath(url.pathname);
  if (!assetPath) {
    return new Response("Invalid dashboard asset path", { status: 400 });
  }

  const response = await readDashboardAsset(assetPath);
  if (response) return response;

  if (assetPath !== "index.html" && !assetPath.startsWith("assets/")) {
    const indexResponse = await readDashboardAsset("index.html");
    if (indexResponse) return indexResponse;
  }

  return new Response(renderDashboardHtml(), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function dashboardAssetPath(pathname: string): string | null {
  const stripped = pathname === "/dashboard"
    ? "index.html"
    : pathname.replace(/^\/dashboard\/?/, "") || "index.html";
  let decoded: string;
  try {
    decoded = decodeURIComponent(stripped);
  } catch {
    return null;
  }
  if (
    decoded.startsWith("/") || decoded.includes("..") ||
    decoded.includes("\\")
  ) {
    return null;
  }
  return decoded.endsWith("/") ? `${decoded}index.html` : decoded;
}

async function readDashboardAsset(assetPath: string): Promise<Response | null> {
  const filePath = `${Deno.cwd()}/dist/dashboard/${assetPath}`;
  try {
    const body = await Deno.readFile(filePath);
    return new Response(body, {
      headers: {
        "Content-Type": contentTypeForPath(assetPath),
        "Cache-Control": assetPath.startsWith("assets/")
          ? "public, max-age=31536000, immutable"
          : "no-store",
      },
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

function contentTypeForPath(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".ico")) return "image/x-icon";
  return "application/octet-stream";
}

function isDashboardPath(pathname: string): boolean {
  return pathname === "/dashboard" || pathname.startsWith("/dashboard/");
}

// 请求处理器
const handler = async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    if (req.method === "GET" && isDashboardPath(url.pathname)) {
      return await handleDashboardRequest(req);
    }
    if (req.method === "GET" && url.pathname === "/api/health") {
      return await handleHealthRequest(req);
    }
    if (req.method === "GET" && url.pathname === "/api/config/summary") {
      return await handleConfigSummaryRequest(req);
    }
    if (req.method === "GET" && url.pathname === "/api/accounts/insights") {
      return await handleAccountInsightsRequest(req);
    }
    if (
      url.pathname === "/api/config/providers" ||
      url.pathname.startsWith("/api/config/weixin/accounts") ||
      url.pathname.startsWith("/api/config/capabilities") ||
      url.pathname.startsWith("/api/config/features/article/profiles")
    ) {
      const unauthorized = await verifyRequestAuth(req);
      if (unauthorized) return unauthorized;
      const config = await getAppConfig();
      const stores = createLocalArticleRuntimeStores(config);
      const response = await handleRuntimeConfigApi(
        req,
        url.pathname,
        stores.runtimeConfigStore,
        config,
      );
      if (response) return response;
    }
    if (url.pathname === "/api/runs" || url.pathname.startsWith("/api/runs/")) {
      return await handleRunsRequest(req, url.pathname);
    }
    if (url.pathname === "/api/artifacts") {
      return await handleArtifactRequest(req);
    }

    // 验证 Authorization 请求头
    const unauthorized = await verifyRequestAuth(req);
    if (unauthorized) {
      const body = await unauthorized.json();
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: body.error,
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }

    // 规范化路径（移除开头和结尾的斜杠，处理可能的错误格式）
    const normalizedPath = url.pathname.replace(/^\/+|\/+$/g, "");

    // 只处理 api/workflow 路径的请求
    if (normalizedPath === "api/workflow") {
      return await rpcServer.handleRequest(req);
    }

    // 处理其他请求
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32601,
          message: "无效的API路径",
          data: {
            path: normalizedPath,
            expectedPath: "api/workflow",
          },
        },
      }),
      {
        status: 404,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    console.error("请求处理错误:", error);
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "服务器内部错误",
          data: {
            error: error instanceof Error ? error.message : String(error),
          },
        },
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }
};

export default async function startServer(port = 8000) {
  Deno.serve({ port }, handler);
  logger.info(`服务监听在 http://0.0.0.0:${port}`);
  logger.info("dashboard 地址: http://localhost:8000/dashboard");
}
