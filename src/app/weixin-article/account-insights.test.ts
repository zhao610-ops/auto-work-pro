import { assertEquals } from "@std/assert";
import { buildWeixinAccountInsights } from "@src/app/weixin-article/account-insights.ts";
import type { EditorialMemoryStore } from "@src/core/ports/editorial-memory-store.ts";

Deno.test("buildWeixinAccountInsights keeps quality and feedback scoped by account", async () => {
  const memoryStore: EditorialMemoryStore = {
    async getContext(_options) {
      return {
        recentArticles: [
          {
            runId: "run-main",
            profileId: "profile",
            accountId: "main",
            title: "主号文章",
            thesis: "主号观点",
            keywords: ["AI"],
            topicTitles: ["AI"],
            sourceUrls: [],
            qualityScore: 90,
            publishStatus: "draft",
            dryRun: true,
            createdAt: "2026-05-29T01:00:00.000Z",
          },
          {
            runId: "run-lab",
            profileId: "profile",
            accountId: "lab",
            title: "实验号文章",
            thesis: "实验号观点",
            keywords: ["产品"],
            topicTitles: ["产品"],
            sourceUrls: [],
            qualityScore: 70,
            publishStatus: "draft",
            dryRun: true,
            createdAt: "2026-05-29T00:00:00.000Z",
          },
        ],
        recentFeedback: [
          {
            runId: "run-main",
            profileId: "profile",
            accountId: "main",
            rating: "good",
            note: "角度清楚",
            createdAt: "2026-05-29T01:10:00.000Z",
            updatedAt: "2026-05-29T01:10:00.000Z",
          },
          {
            runId: "run-lab",
            profileId: "profile",
            accountId: "lab",
            rating: "bad",
            createdAt: "2026-05-29T00:10:00.000Z",
            updatedAt: "2026-05-29T00:10:00.000Z",
          },
        ],
        recentTopicFeedback: [
          {
            runId: "run-main",
            topicId: "topic-main",
            profileId: "profile",
            accountId: "main",
            action: "lead",
            title: "主号锁定主题",
            reason: "适合主号",
            createdAt: "2026-05-29T01:12:00.000Z",
            updatedAt: "2026-05-29T01:12:00.000Z",
          },
          {
            runId: "run-lab",
            topicId: "topic-lab",
            profileId: "profile",
            accountId: "lab",
            action: "skip",
            title: "实验号跳过主题",
            reason: "不适合",
            createdAt: "2026-05-29T00:12:00.000Z",
            updatedAt: "2026-05-29T00:12:00.000Z",
          },
        ],
        sourcePerformance: [],
      };
    },
    recordArticle: () => Promise.resolve(),
    recordSourceHealth: () => Promise.resolve(),
    getFeedback: () => Promise.resolve(null),
    saveFeedback: (input) =>
      Promise.resolve({
        ...input,
        createdAt: input.createdAt ?? "2026-05-29T00:00:00.000Z",
        updatedAt: input.updatedAt ?? "2026-05-29T00:00:00.000Z",
      }),
    deleteFeedback: () => Promise.resolve(false),
    listTopicFeedback: () => Promise.resolve([]),
    saveTopicFeedback: (input) =>
      Promise.resolve({
        ...input,
        createdAt: input.createdAt ?? "2026-05-29T00:00:00.000Z",
        updatedAt: input.updatedAt ?? "2026-05-29T00:00:00.000Z",
      }),
    deleteTopicFeedback: () => Promise.resolve(false),
  };

  const insights = await buildWeixinAccountInsights({
    accounts: [
      {
        id: "main",
        name: "主号",
        enabled: true,
        brand: {
          positioning: "AI 深度解释",
          audience: "技术管理者",
          tone: "冷静、克制",
          titleStyle: "结论前置",
        },
        defaults: { sourceGroupIds: ["web"] },
        createdAt: "2026-05-29T00:00:00.000Z",
        updatedAt: "2026-05-29T00:00:00.000Z",
      },
      {
        id: "lab",
        name: "实验号",
        enabled: true,
        brand: {},
        defaults: {},
        createdAt: "2026-05-29T00:00:00.000Z",
        updatedAt: "2026-05-29T00:00:00.000Z",
      },
    ],
    runs: [
      {
        runId: "run-main",
        accountId: "main",
        parentRunId: "matrix-1",
        mode: "local",
        status: "succeeded",
        dryRun: true,
        trigger: "manual",
        createdAt: "2026-05-29T01:00:00.000Z",
        updatedAt: "2026-05-29T01:05:00.000Z",
        artifacts: [],
      },
    ],
    editorialMemoryStore: memoryStore,
  });

  assertEquals(insights[0].accountId, "main");
  assertEquals(insights[0].averageQualityScore, 90);
  assertEquals(insights[0].recentArticles.map((item) => item.title), [
    "主号文章",
  ]);
  assertEquals(insights[0].feedbackCounts.good, 1);
  assertEquals(insights[0].topicFeedbackCounts.lead, 1);
  assertEquals(insights[0].latestTopicFeedback?.title, "主号锁定主题");
  assertEquals(insights[0].latestMatrixRunId, "matrix-1");
  assertEquals(insights[0].learning.profileCompleteness.score, 100);
  assertEquals(insights[0].learning.riskSignals.length, 0);
  assertEquals(
    insights[0].learning.writingGuidance.includes(
      "默认面向读者：技术管理者",
    ),
    true,
  );
  assertEquals(
    insights[0].learning.writingGuidance.includes(
      "优先延续锁定主线：主号锁定主题",
    ),
    true,
  );
  assertEquals(insights[1].accountId, "lab");
  assertEquals(insights[1].averageQualityScore, 70);
  assertEquals(insights[1].feedbackCounts.bad, 1);
  assertEquals(insights[1].topicFeedbackCounts.skip, 1);
  assertEquals(insights[1].learning.profileCompleteness.score, 0);
  assertEquals(
    insights[1].learning.recommendedActions.some((item) =>
      item.title === "补齐账号画像"
    ),
    true,
  );
  assertEquals(
    insights[1].learning.recommendedActions.some((item) =>
      item.title === "提高发布前质量阈值"
    ),
    true,
  );
});
