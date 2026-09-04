import { assertEquals } from "@std/assert";
import { SQLiteEditorialMemoryStore } from "@src/platform/local/sqlite-editorial-memory-store.ts";

Deno.test("SQLiteEditorialMemoryStore records article memory and source performance", async () => {
  const store = new SQLiteEditorialMemoryStore(":memory:");

  await store.recordArticle({
    runId: "run-1",
    profileId: "profile-1",
    accountId: "main",
    title: "今日 AI 主线",
    thesis: "模型能力正在进入产品交付阶段",
    keywords: ["AI", "产品"],
    topicTitles: ["模型产品化"],
    sourceUrls: ["https://example.com/a"],
    qualityScore: 86,
    publishStatus: "draft",
    dryRun: true,
    createdAt: "2026-05-23T00:00:00.000Z",
  });
  await store.recordArticle({
    runId: "run-2",
    profileId: "profile-1",
    accountId: "lab",
    title: "另一个账号的文章",
    keywords: ["AI"],
    topicTitles: ["模型"],
    sourceUrls: ["https://example.com/lab"],
    qualityScore: 72,
    publishStatus: "draft",
    dryRun: true,
    createdAt: "2026-05-23T00:00:01.000Z",
  });

  await store.recordSourceHealth("run-1", {
    generatedAt: "2026-05-23T00:01:00.000Z",
    records: [
      {
        url: "https://example.com/a",
        group: "default",
        status: "succeeded",
        selectedProvider: "firecrawl",
        articleCount: 2,
        failures: [],
      },
      {
        url: "https://example.com/b",
        group: "web",
        status: "failed",
        articleCount: 0,
        failures: [{ provider: "jina", message: "timeout" }],
      },
    ],
  });
  await store.recordSourceHealth("run-2", {
    generatedAt: "2026-05-23T00:02:00.000Z",
    records: [
      {
        url: "https://example.com/a",
        group: "default",
        status: "empty",
        articleCount: 0,
        failures: [],
      },
    ],
  });

  const context = await store.getContext({
    profileId: "profile-1",
    accountId: "main",
  });

  assertEquals(context.recentArticles.length, 1);
  assertEquals(context.recentArticles[0].title, "今日 AI 主线");
  assertEquals(context.recentArticles[0].accountId, "main");
  assertEquals(context.recentArticles[0].keywords, ["AI", "产品"]);
  assertEquals(context.sourcePerformance.length, 2);
  const sourceA = context.sourcePerformance.find((item) =>
    item.url === "https://example.com/a"
  );
  assertEquals(sourceA?.runs, 2);
  assertEquals(sourceA?.successes, 1);
  assertEquals(sourceA?.empty, 1);
  assertEquals(sourceA?.totalArticles, 2);

  const feedback = await store.saveFeedback({
    runId: "run-1",
    profileId: "profile-1",
    accountId: "main",
    rating: "good",
    note: "主题具体，证据充分",
  });
  assertEquals(feedback.rating, "good");
  assertEquals(feedback.accountId, "main");
  assertEquals((await store.getFeedback("run-1"))?.note, "主题具体，证据充分");

  const contextWithFeedback = await store.getContext({
    profileId: "profile-1",
    accountId: "main",
  });
  assertEquals(contextWithFeedback.recentFeedback.length, 1);
  assertEquals(contextWithFeedback.recentFeedback[0].rating, "good");

  const topicFeedback = await store.saveTopicFeedback({
    runId: "run-1",
    topicId: "topic-ai-products",
    profileId: "profile-1",
    accountId: "main",
    action: "lead",
    title: "模型产品化",
    reason: "适合主账号定位",
  });
  assertEquals(topicFeedback.action, "lead");
  assertEquals(topicFeedback.title, "模型产品化");
  assertEquals(topicFeedback.accountId, "main");

  const runTopicFeedback = await store.listTopicFeedback({ runId: "run-1" });
  assertEquals(runTopicFeedback.length, 1);
  assertEquals(runTopicFeedback[0].topicId, "topic-ai-products");

  const contextWithTopicFeedback = await store.getContext({
    profileId: "profile-1",
    accountId: "main",
  });
  assertEquals(contextWithTopicFeedback.recentTopicFeedback.length, 1);
  assertEquals(contextWithTopicFeedback.recentTopicFeedback[0].action, "lead");

  assertEquals(
    await store.deleteTopicFeedback("run-1", "topic-ai-products"),
    true,
  );
  assertEquals((await store.listTopicFeedback({ runId: "run-1" })).length, 0);

  assertEquals(await store.deleteFeedback("run-1"), true);
  assertEquals(await store.getFeedback("run-1"), null);
});

Deno.test("SQLiteEditorialMemoryStore can isolate editorial memory by account", async () => {
  const store = new SQLiteEditorialMemoryStore(":memory:");

  await store.recordArticle({
    runId: "run-main",
    profileId: "profile-1",
    accountId: "main",
    title: "主账号文章",
    keywords: ["main"],
    topicTitles: ["主账号主题"],
    sourceUrls: [],
    publishStatus: "draft",
    dryRun: true,
    createdAt: "2026-05-23T00:00:02.000Z",
  });
  await store.recordArticle({
    runId: "run-lab",
    profileId: "profile-1",
    accountId: "lab",
    title: "实验账号文章",
    keywords: ["lab"],
    topicTitles: ["实验账号主题"],
    sourceUrls: [],
    publishStatus: "draft",
    dryRun: true,
    createdAt: "2026-05-23T00:00:01.000Z",
  });
  await store.recordArticle({
    runId: "run-global",
    profileId: "profile-1",
    title: "全局历史文章",
    keywords: ["global"],
    topicTitles: ["全局主题"],
    sourceUrls: [],
    publishStatus: "draft",
    dryRun: true,
    createdAt: "2026-05-23T00:00:00.000Z",
  });

  await store.saveFeedback({
    runId: "run-main",
    profileId: "profile-1",
    accountId: "main",
    rating: "good",
    note: "主账号风格正确",
  });
  await store.saveFeedback({
    runId: "run-global",
    profileId: "profile-1",
    rating: "bad",
    note: "全局旧反馈",
  });
  await store.saveTopicFeedback({
    runId: "run-main",
    topicId: "topic-main",
    profileId: "profile-1",
    accountId: "main",
    action: "lead",
    title: "主账号主题",
  });
  await store.saveTopicFeedback({
    runId: "run-lab",
    topicId: "topic-lab",
    profileId: "profile-1",
    accountId: "lab",
    action: "skip",
    title: "实验账号主题",
  });

  const strictMain = await store.getContext({
    profileId: "profile-1",
    accountId: "main",
    strictAccount: true,
  });
  assertEquals(strictMain.recentArticles.map((item) => item.title), [
    "主账号文章",
  ]);
  assertEquals(strictMain.recentFeedback.map((item) => item.note), [
    "主账号风格正确",
  ]);
  assertEquals(strictMain.recentTopicFeedback.map((item) => item.topicId), [
    "topic-main",
  ]);

  const looseMain = await store.getContext({
    profileId: "profile-1",
    accountId: "main",
  });
  assertEquals(looseMain.recentArticles.map((item) => item.title), [
    "主账号文章",
    "全局历史文章",
  ]);
  assertEquals(looseMain.recentFeedback.map((item) => item.note), [
    "主账号风格正确",
    "全局旧反馈",
  ]);
});
