import { assertEquals } from "@std/assert";
import { checkWeixinAccountRelay } from "@src/app/weixin-article/weixin-account-relay-check.ts";
import {
  defineConfig,
  resolveTrendPublishConfig,
} from "@src/utils/config/define-config.ts";

Deno.test("checkWeixinAccountRelay validates selected account through relay", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const result = await checkWeixinAccountRelay(
    createConfig(),
    "lab",
    {
      request: async (_url, options) => {
        capturedBody = JSON.parse(String(options?.body));
        return { success: true, data: { result: true } };
      },
    },
  );

  assertEquals(result.ok, true);
  assertEquals(result.status, "ok");
  assertEquals(result.accountId, "lab");
  assertEquals(result.appIdMasked, "wx-l****ount");
  assertEquals(
    (capturedBody?.account as { accountId?: string }).accountId,
    "lab",
  );
});

Deno.test("checkWeixinAccountRelay reports relay IP whitelist failure", async () => {
  const result = await checkWeixinAccountRelay(
    createConfig(),
    "lab",
    {
      request: async () => ({
        success: true,
        data: { result: "203.0.113.10" },
      }),
    },
  );

  assertEquals(result.ok, false);
  assertEquals(result.status, "ip_not_whitelisted");
  assertEquals(result.result, "203.0.113.10");
});

Deno.test("checkWeixinAccountRelay reports missing relay config without network call", async () => {
  let called = false;
  const result = await checkWeixinAccountRelay(
    createConfig({ relay: false }),
    "lab",
    {
      request: async () => {
        called = true;
        return { success: true, data: { result: true } };
      },
    },
  );

  assertEquals(called, false);
  assertEquals(result.ok, false);
  assertEquals(result.status, "relay_unconfigured");
});

function createConfig(options: { relay?: boolean } = {}) {
  const relay = options.relay !== false;
  return resolveTrendPublishConfig(defineConfig({
    server: { apiKey: "server-key" },
    providers: {
      ai: {
        baseUrl: "https://llm.example.com/v1",
        apiKey: "llm-key",
        model: "model",
      },
      publish: {
        weixin: {
          appId: "wx-default",
          appSecret: "secret-default",
          accounts: {
            lab: {
              appId: "wx-lab-account",
              appSecret: "secret-lab",
              author: "实验室",
            },
          },
        },
        weixinRelay: {
          url: relay ? "https://relay.example.com" : "",
          token: relay ? "relay-token" : "",
        },
      },
    },
    fetchGroups: {
      default: ["auto"],
    },
    features: {
      article: {
        sources: ["https://example.com"],
        publisher: {
          provider: "weixin-relay",
          accountId: "lab",
        },
      },
    },
  }));
}
