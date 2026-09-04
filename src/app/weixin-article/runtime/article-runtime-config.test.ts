import { assert, assertEquals, assertRejects } from "@std/assert";
import { SQLiteRuntimeConfigStore } from "@src/platform/local/sqlite-runtime-config-store.ts";
import {
  resolveTrendPublishConfig,
  type TrendPublishConfig,
} from "@src/utils/config/define-config.ts";
import {
  DEFAULT_BODY_IMAGE_CAPABILITY_ID,
  DEFAULT_COVER_IMAGE_CAPABILITY_ID,
  DEFAULT_LLM_CAPABILITY_ID,
} from "@src/app/weixin-article/runtime/article-runtime-config.ts";
import {
  createArticleRuntimeProfile,
  getArticleRuntimeProfileDetail,
  parseSourcesForRuntime,
  resolveArticleRuntimeConfig,
  saveArticleProfileConfig,
  seedArticleRuntimeConfig,
} from "@src/app/weixin-article/runtime/article-runtime-config.service.ts";
import { handleRuntimeConfigApi } from "@src/app/weixin-article/runtime/runtime-config-api.ts";

Deno.test("runtime config seeds article profile and shared capabilities", async () => {
  const store = new SQLiteRuntimeConfigStore(":memory:");
  const config = createConfig();

  await seedArticleRuntimeConfig(store, config);

  const capabilities = await store.listCapabilityProfiles();
  const profiles = await store.listFeatureProfiles("article");
  const detail = await getArticleRuntimeProfileDetail(store, config);

  assert(capabilities.some((item) => item.id === DEFAULT_LLM_CAPABILITY_ID));
  assertEquals(profiles.length, 1);
  assertEquals(detail.sources.map((item) => item.raw), [
    "web:https://example.com",
  ]);
  assertEquals(detail.fetchGroups.web, ["firecrawl", "jina"]);
  assertEquals(detail.article.sourceLimits, {
    maxAgeDays: 14,
    maxItemsPerSource: 20,
  });
  assertEquals(detail.schedule?.cron, "0 3 * * *");
});

Deno.test("runtime config merges TS config sources and fetch groups into existing profiles", async () => {
  const store = new SQLiteRuntimeConfigStore(":memory:");
  const config = createConfig();
  await seedArticleRuntimeConfig(store, config);

  const nextConfig = resolveTrendPublishConfig({
    ...createConfigSource(),
    fetchGroups: {
      default: ["auto"],
      web: ["firecrawl"],
      search: ["jina-search"],
    },
    features: {
      article: {
        ...createConfigSource().features?.article,
        sources: [
          "web:https://example.com",
          "search:AI agent news",
        ],
      },
    },
  });

  const detail = await getArticleRuntimeProfileDetail(store, nextConfig);
  const resolved = await resolveArticleRuntimeConfig(
    store,
    nextConfig,
    detail.profile.id,
  );

  assertEquals(detail.fetchGroups.web, ["firecrawl", "jina"]);
  assertEquals(detail.fetchGroups.search, ["jina-search"]);
  assertEquals(detail.sources.map((item) => item.raw), [
    "web:https://example.com",
    "search:AI agent news",
  ]);
  assertEquals(resolved.config.features.article.sources, [
    "web:https://example.com",
    "search:AI agent news",
  ]);
});

Deno.test("runtime config appends new TS fetch fallbacks to existing runtime groups", async () => {
  const store = new SQLiteRuntimeConfigStore(":memory:");
  const config = createConfig();
  await seedArticleRuntimeConfig(store, config);

  const detail = await getArticleRuntimeProfileDetail(store, config);
  await store.replaceArticleFetchGroups(detail.profile.id, {
    default: ["auto"],
    web: ["firecrawl"],
  });

  const refreshed = await getArticleRuntimeProfileDetail(store, config);
  assertEquals(refreshed.fetchGroups.web, ["firecrawl", "jina"]);
});

Deno.test("runtime config resolves capability references and feature overrides", async () => {
  const store = new SQLiteRuntimeConfigStore(":memory:");
  const config = createConfig();
  await seedArticleRuntimeConfig(store, config);

  const bodyImage = await store.getCapabilityProfile(
    DEFAULT_BODY_IMAGE_CAPABILITY_ID,
  );
  assert(bodyImage);
  await store.saveCapabilityProfile({
    ...bodyImage,
    config: { count: 3, size: "512*512" },
  });

  const detail = await getArticleRuntimeProfileDetail(store, config);
  await saveArticleProfileConfig(store, config, detail.profile.id, {
    bodyImages: {
      mode: "all",
      imageProfileId: DEFAULT_BODY_IMAGE_CAPABILITY_ID,
      overrides: {
        count: 2,
      },
    },
  });

  const resolved = await resolveArticleRuntimeConfig(
    store,
    config,
    detail.profile.id,
  );

  assertEquals(resolved.config.features.article.bodyImages.mode, "all");
  assertEquals(resolved.config.features.article.bodyImages.count, 2);
  assertEquals(resolved.config.features.article.bodyImages.size, "1024*1024");
  assertEquals(resolved.snapshot.profile?.["id"], detail.profile.id);
});

Deno.test("runtime config resolves MiniMax image capability provider", async () => {
  const store = new SQLiteRuntimeConfigStore(":memory:");
  const config = createConfig();
  await seedArticleRuntimeConfig(store, config);

  const coverImage = await store.getCapabilityProfile(
    DEFAULT_COVER_IMAGE_CAPABILITY_ID,
  );
  const bodyImage = await store.getCapabilityProfile(
    DEFAULT_BODY_IMAGE_CAPABILITY_ID,
  );
  assert(coverImage);
  assert(bodyImage);
  await store.saveCapabilityProfile({
    ...coverImage,
    provider: "minimax",
    config: {},
  });
  await store.saveCapabilityProfile({
    ...bodyImage,
    provider: "minimax",
    config: { size: "1024*1024" },
  });

  const resolved = await resolveArticleRuntimeConfig(store, config);

  assertEquals(resolved.config.features.article.cover.provider, "minimax");
  assertEquals(resolved.config.features.article.cover.model, "image-01");
  assertEquals(resolved.config.features.article.bodyImages.provider, "minimax");
  assertEquals(resolved.config.features.article.bodyImages.model, "image-01");
});

Deno.test("runtime config resolves weixin account defaults without mutating article profile", async () => {
  const store = new SQLiteRuntimeConfigStore(":memory:");
  const config = createConfig();
  await seedArticleRuntimeConfig(store, config);
  const detail = await getArticleRuntimeProfileDetail(store, config);

  await store.saveWeixinAccountProfile({
    id: "lab",
    name: "实验室账号",
    enabled: true,
    defaultArticleProfileId: detail.profile.id,
    brand: {
      positioning: "给工程团队看的 AI 基建观察",
      audience: "技术负责人和开发者",
      tone: "冷静、具体、有判断",
      titleStyle: "少用速递，强调新闻钩子",
      forbiddenTopics: ["空泛融资新闻"],
    },
    defaults: {
      template: "minimal",
      promptProfile: "business",
      count: 3,
    },
  });

  const resolved = await resolveArticleRuntimeConfig(
    store,
    config,
    undefined,
    "lab",
  );
  const unchanged = await getArticleRuntimeProfileDetail(
    store,
    config,
    detail.profile.id,
  );

  assertEquals(resolved.account?.id, "lab");
  assertEquals(resolved.config.features.article.publisher.accountId, "lab");
  assertEquals(resolved.config.features.article.renderer.template, "minimal");
  assertEquals(
    resolved.config.features.article.renderer.promptProfile,
    "business",
  );
  assertEquals(resolved.config.features.article.count, 3);
  assertEquals(resolved.snapshot.account?.["id"], "lab");
  assertEquals(unchanged.article.renderer.template, "dynamic");
  assertEquals(unchanged.article.count, 5);
});

Deno.test("runtime config uses account default article profile when no profile is forced", async () => {
  const store = new SQLiteRuntimeConfigStore(":memory:");
  const config = createConfig();
  await seedArticleRuntimeConfig(store, config);
  const defaultDetail = await getArticleRuntimeProfileDetail(store, config);
  const accountProfile = await createArticleRuntimeProfile(store, config, {
    name: "实验室专用方案",
    copyFromProfileId: defaultDetail.profile.id,
  });
  await saveArticleProfileConfig(store, config, accountProfile.profile.id, {
    count: 2,
    renderer: {
      ...accountProfile.article.renderer,
      template: "minimal",
    },
  });

  await store.saveWeixinAccountProfile({
    id: "lab",
    name: "实验室账号",
    enabled: true,
    defaultArticleProfileId: accountProfile.profile.id,
    brand: {
      positioning: "面向工程团队",
    },
    defaults: {},
  });

  const accountDefault = await resolveArticleRuntimeConfig(
    store,
    config,
    undefined,
    "lab",
  );
  const forcedDefault = await resolveArticleRuntimeConfig(
    store,
    config,
    defaultDetail.profile.id,
    "lab",
  );

  assertEquals(accountDefault.profile.id, accountProfile.profile.id);
  assertEquals(accountDefault.config.features.article.count, 2);
  assertEquals(
    accountDefault.config.features.article.renderer.template,
    "minimal",
  );
  assertEquals(forcedDefault.profile.id, defaultDetail.profile.id);
  assertEquals(forcedDefault.config.features.article.count, 5);
});

Deno.test("runtime config filters sources by account source groups", async () => {
  const store = new SQLiteRuntimeConfigStore(":memory:");
  const config = createConfig();
  await seedArticleRuntimeConfig(store, config);
  const detail = await getArticleRuntimeProfileDetail(store, config);
  await store.replaceArticleSources(
    detail.profile.id,
    parseSourcesForRuntime([
      "https://example.com/default",
      "web:https://example.com/web",
    ]),
  );
  await store.saveWeixinAccountProfile({
    id: "web-only",
    name: "网页精选号",
    enabled: true,
    defaultArticleProfileId: detail.profile.id,
    brand: {},
    defaults: {
      sourceGroupIds: ["web"],
    },
  });

  const resolved = await resolveArticleRuntimeConfig(
    store,
    config,
    undefined,
    "web-only",
  );

  assertEquals(resolved.config.features.article.sources, [
    "web:https://example.com/web",
    "web:https://example.com",
  ]);
  assertEquals(
    (resolved.snapshot.sources as Array<{ group: string }>).map((item) =>
      item.group
    ),
    ["web", "web"],
  );
});

Deno.test("runtime config rejects account source groups without enabled sources", async () => {
  const store = new SQLiteRuntimeConfigStore(":memory:");
  const config = createConfig();
  await seedArticleRuntimeConfig(store, config);
  const detail = await getArticleRuntimeProfileDetail(store, config);
  await store.saveWeixinAccountProfile({
    id: "missing-source-group",
    name: "缺来源账号",
    enabled: true,
    defaultArticleProfileId: detail.profile.id,
    brand: {},
    defaults: {
      sourceGroupIds: ["social"],
    },
  });

  await assertRejects(
    () =>
      resolveArticleRuntimeConfig(
        store,
        config,
        undefined,
        "missing-source-group",
      ),
    Error,
    "数据源分组没有可用来源",
  );
});

Deno.test("runtime config API manages weixin account profiles", async () => {
  const store = new SQLiteRuntimeConfigStore(":memory:");
  const config = createConfig();
  await seedArticleRuntimeConfig(store, config);

  const createResponse = await handleRuntimeConfigApi(
    jsonRequest({
      id: "main",
      name: "主账号",
      enabled: true,
      brand: { positioning: "AI 新闻精选" },
      defaults: { count: 4, sourceGroupIds: ["web"] },
    }, "POST"),
    "/api/config/weixin/accounts",
    store,
    config,
  );
  assert(createResponse);
  assertEquals(createResponse.status, 201);

  const patchResponse = await handleRuntimeConfigApi(
    jsonRequest({ name: "主账号 Pro" }, "PATCH"),
    "/api/config/weixin/accounts/main",
    store,
    config,
  );
  assert(patchResponse);
  const patched = await patchResponse.json();
  assertEquals(patched.account.name, "主账号 Pro");
  assertEquals(patched.account.brand.positioning, "AI 新闻精选");
  assertEquals(patched.account.defaults.sourceGroupIds, ["web"]);

  const deleteResponse = await handleRuntimeConfigApi(
    jsonRequest({}, "DELETE"),
    "/api/config/weixin/accounts/main",
    store,
    config,
  );
  assert(deleteResponse);
  const deleted = await deleteResponse.json();
  assertEquals(deleted.deleted, true);
});

Deno.test("runtime config API persists weixin relay check status on account ops", async () => {
  const store = new SQLiteRuntimeConfigStore(":memory:");
  const config = createConfig();
  await seedArticleRuntimeConfig(store, config);
  await store.saveWeixinAccountProfile({
    id: "main",
    name: "主账号",
    enabled: true,
    brand: {},
    defaults: {},
  });

  const checkResponse = await handleRuntimeConfigApi(
    jsonRequest({}, "POST"),
    "/api/config/weixin/accounts/main/relay-check",
    store,
    config,
  );
  assert(checkResponse);
  const checkPayload = await checkResponse.json();
  assertEquals(checkPayload.check.status, "relay_unconfigured");

  const stored = await store.getWeixinAccountProfile("main");
  assertEquals(stored?.ops?.relayCheck?.status, "relay_unconfigured");

  const getResponse = await handleRuntimeConfigApi(
    jsonRequest({}, "GET"),
    "/api/config/weixin/accounts/main",
    store,
    config,
  );
  assert(getResponse);
  const getPayload = await getResponse.json();
  assertEquals(
    getPayload.account.relay.lastCheck.status,
    "relay_unconfigured",
  );
  assertEquals(
    getPayload.account.relay.lastCheckedAt,
    checkPayload.check.checkedAt,
  );
});

Deno.test("runtime config migrates legacy DashScope cover model", async () => {
  const store = new SQLiteRuntimeConfigStore(":memory:");
  const config = resolveTrendPublishConfig({
    ...createConfigSource(),
    features: {
      article: {
        ...createConfigSource().features?.article,
        cover: {
          enabled: true,
          provider: "dashscope",
          model: "wanx-poster-generation-v1",
        },
      },
    },
  });

  await seedArticleRuntimeConfig(store, config);

  const capability = await store.getCapabilityProfile(
    DEFAULT_COVER_IMAGE_CAPABILITY_ID,
  );
  const detail = await getArticleRuntimeProfileDetail(store, config);
  const resolved = await resolveArticleRuntimeConfig(store, config);

  assertEquals(capability?.config.model, "qwen-image-2.0-pro");
  assertEquals(detail.article.cover.overrides?.model, "qwen-image-2.0-pro");
  assertEquals(
    resolved.config.features.article.cover.model,
    "qwen-image-2.0-pro",
  );
});

Deno.test("runtime schedule heartbeat is idempotent per slot", async () => {
  const store = new SQLiteRuntimeConfigStore(":memory:");
  const config = createConfig();
  await seedArticleRuntimeConfig(store, config);

  const due = await store.listDueSchedules(
    new Date("2026-05-22T19:00:00.000Z"),
  );
  assertEquals(due.length, 1);
  assert(await store.markScheduleTriggered(due[0].schedule.id, due[0].slot));
  assertEquals(
    await store.markScheduleTriggered(due[0].schedule.id, due[0].slot),
    false,
  );
});

Deno.test("runtime config store keeps one default article profile", async () => {
  const store = new SQLiteRuntimeConfigStore(":memory:");
  const config = createConfig();
  await seedArticleRuntimeConfig(store, config);

  const profiles = await store.listFeatureProfiles("article");
  const original = profiles[0];
  await store.saveFeatureProfile({
    id: "article-second",
    featureKey: "article",
    name: "Second",
    enabled: true,
    isDefault: true,
    config: original.config,
    version: 1,
  });

  const next = await store.listFeatureProfiles("article");
  assertEquals(next.filter((profile) => profile.isDefault).length, 1);
  assertEquals(
    await store.getFeatureProfile("article"),
    next.find((profile) => profile.id === "article-second"),
  );
});

Deno.test("runtime config API deletes non-default article profile", async () => {
  const store = new SQLiteRuntimeConfigStore(":memory:");
  const config = createConfig();
  await seedArticleRuntimeConfig(store, config);

  const response = await handleRuntimeConfigApi(
    jsonRequest({ name: "Second" }, "POST"),
    "/api/config/features/article/profiles",
    store,
    config,
  );
  assert(response);
  const body = await response.json();
  const profileId = body.profile.profile.id as string;

  const deleteResponse = await handleRuntimeConfigApi(
    jsonRequest({}, "DELETE"),
    `/api/config/features/article/profiles/${profileId}`,
    store,
    config,
  );

  assert(deleteResponse);
  assertEquals(deleteResponse.status, 200);
  assertEquals(await store.getFeatureProfile("article", profileId), null);
});

Deno.test("runtime config API keeps default article profile protected", async () => {
  const store = new SQLiteRuntimeConfigStore(":memory:");
  const config = createConfig();
  await seedArticleRuntimeConfig(store, config);
  const detail = await getArticleRuntimeProfileDetail(store, config);

  const response = await handleRuntimeConfigApi(
    jsonRequest({}, "DELETE"),
    `/api/config/features/article/profiles/${detail.profile.id}`,
    store,
    config,
  );

  assert(response);
  assertEquals(response.status, 400);
});

Deno.test("runtime config store rejects child config for missing profile", async () => {
  const store = new SQLiteRuntimeConfigStore(":memory:");
  const config = createConfig();
  await seedArticleRuntimeConfig(store, config);

  await assertRejects(
    () => store.replaceArticleSources("missing", []),
    Error,
    "功能 Profile 不存在: missing",
  );
});

Deno.test("runtime config API rejects invalid fetch groups", async () => {
  const store = new SQLiteRuntimeConfigStore(":memory:");
  const config = createConfig();
  await seedArticleRuntimeConfig(store, config);
  const detail = await getArticleRuntimeProfileDetail(store, config);

  const response = await handleRuntimeConfigApi(
    jsonRequest({
      fetchGroups: {
        web: ["firecrawl", "unknown"],
      },
    }, "PUT"),
    `/api/config/features/article/profiles/${detail.profile.id}/fetch-groups`,
    store,
    config,
  );

  assert(response);
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error, "运行时配置校验失败");
  assertEquals(body.issues[0].path, "fetchGroups.web.1");
});

Deno.test("runtime config API returns validation issues for invalid capability kind", async () => {
  const store = new SQLiteRuntimeConfigStore(":memory:");
  const config = createConfig();
  await seedArticleRuntimeConfig(store, config);

  const response = await handleRuntimeConfigApi(
    jsonRequest({
      kind: "unknown",
      name: "bad",
      provider: "dashscope",
      config: {},
    }, "POST"),
    "/api/config/capabilities",
    store,
    config,
  );

  assert(response);
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error, "运行时配置校验失败");
  assertEquals(body.issues[0].path, "kind");
});

Deno.test("runtime config API returns validation issues for invalid capability config", async () => {
  const store = new SQLiteRuntimeConfigStore(":memory:");
  const config = createConfig();
  await seedArticleRuntimeConfig(store, config);

  const response = await handleRuntimeConfigApi(
    jsonRequest({
      kind: "image-generation",
      name: "bad",
      provider: "dashscope",
      config: "bad",
    }, "POST"),
    "/api/config/capabilities",
    store,
    config,
  );

  assert(response);
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.issues[0].path, "config");
});

Deno.test("runtime config API rejects unknown capability reference", async () => {
  const store = new SQLiteRuntimeConfigStore(":memory:");
  const config = createConfig();
  await seedArticleRuntimeConfig(store, config);
  const detail = await getArticleRuntimeProfileDetail(store, config);

  const response = await handleRuntimeConfigApi(
    jsonRequest({
      article: {
        renderer: {
          llmProfileId: "missing",
        },
      },
    }, "PATCH"),
    `/api/config/features/article/profiles/${detail.profile.id}`,
    store,
    config,
  );

  assert(response);
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.issues[0].path, "article.renderer.llmProfileId");
});

function jsonRequest(body: unknown, method: string): Request {
  if (method === "GET" || method === "HEAD") {
    return new Request("http://localhost/api/config", {
      method,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Request("http://localhost/api/config", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createConfig() {
  return resolveTrendPublishConfig(createConfigSource());
}

function createConfigSource(): TrendPublishConfig {
  return {
    providers: {
      ai: {
        baseUrl: "https://example.com/v1",
        apiKey: "secret",
        model: "chat-model",
      },
      fetch: {
        firecrawl: { apiKey: "firecrawl" },
        jina: { apiKey: "jina" },
      },
      image: {
        dashscope: { apiKey: "dashscope" },
      },
      vector: {
        embedding: {
          baseUrl: "https://example.com/v1",
          apiKey: "embedding",
          model: "embedding-model",
        },
      },
    },
    fetchGroups: {
      default: ["auto"],
      web: ["firecrawl", "jina"],
    },
    features: {
      article: {
        sources: ["web:https://example.com"],
        renderer: {
          template: "dynamic",
          promptProfile: "technology",
        },
        count: 5,
        dryRun: true,
        bodyImages: {
          mode: "missing",
          count: 1,
          size: "1024*1024",
        },
      },
    },
  };
}
