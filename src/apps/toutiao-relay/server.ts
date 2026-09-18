import { Logger } from "@zilla/logger";
import { ToutiaoBrowserSession } from "./browser-session.ts";
import { loadToutiaoRelayConfig } from "./config.ts";
import { errorHttpStatus, toToutiaoRelayError } from "./errors.ts";
import { json, ok, readJson, verifyBearerToken } from "./http.ts";
import type { ToutiaoDraftRequest, ToutiaoPublishRequest } from "./types.ts";

const logger = new Logger("toutiao-relay");
const config = loadToutiaoRelayConfig();
const session = new ToutiaoBrowserSession(config);

logger.info(`Toutiao relay listening on http://0.0.0.0:${config.port}`);
logger.info(`Toutiao browser profile: ${config.profileDir}`);

Deno.addSignalListener?.("SIGINT", () => closeAndExit());
Deno.addSignalListener?.("SIGTERM", () => closeAndExit());

Deno.serve({ port: config.port }, async (request) => {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return json({
      ok: true,
      service: "toutiao-relay",
      mode: "browser-direct-publish",
      timestamp: new Date().toISOString(),
    });
  }

  const unauthorized = await verifyBearerToken(request, config.token);
  if (unauthorized) return unauthorized;

  try {
    if (request.method === "GET" && url.pathname === "/api/toutiao/session") {
      return ok(await session.getSessionStatus());
    }

    if (request.method === "GET" && url.pathname === "/api/toutiao/articles") {
      return ok(
        await session.reconcileArticle({
          idempotencyKey: url.searchParams.get("idempotencyKey") ?? undefined,
          title: url.searchParams.get("title") ?? undefined,
        }),
      );
    }

    if (request.method === "POST" && url.pathname === "/api/toutiao/login") {
      return ok(await session.openLoginPage());
    }

    if (request.method === "POST" && url.pathname === "/api/toutiao/drafts") {
      const payload = await readJson<ToutiaoDraftRequest>(request);
      return ok(await session.saveDraft(payload));
    }

    if (
      request.method === "POST" && url.pathname === "/api/toutiao/publish"
    ) {
      const payload = await readJson<ToutiaoPublishRequest>(request);
      return ok(await session.publishNow(payload));
    }

    return json({ success: false, error: "Not Found" }, { status: 404 });
  } catch (error) {
    const relayError = toToutiaoRelayError(error);
    logger.error(
      `Toutiao relay request failed [${relayError.code}]:`,
      relayError.message,
    );
    return json({
      success: false,
      error: {
        code: relayError.code,
        message: relayError.message,
        details: relayError.details,
      },
    }, { status: errorHttpStatus(relayError.code) });
  }
});

async function closeAndExit(): Promise<void> {
  await session.close();
  Deno.exit(0);
}
