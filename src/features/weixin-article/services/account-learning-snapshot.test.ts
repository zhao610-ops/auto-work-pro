import { assertEquals } from "@std/assert";
import {
  createAccountLearningSnapshot,
} from "@src/features/weixin-article/services/account-learning-snapshot.ts";

Deno.test("createAccountLearningSnapshot explains account profile and feedback rules", () => {
  const snapshot = createAccountLearningSnapshot({
    accountId: "main",
    profileId: "profile-1",
    strictAccount: true,
    accountBrand: {
      positioning: "AI 产品经理视角",
      audience: "技术团队负责人",
      tone: "克制、具体",
      titleStyle: "给出反差和判断",
    },
    memory: {
      recentArticles: [{
        runId: "run-1",
        profileId: "profile-1",
        accountId: "main",
        title: "上一次高分文章",
        keywords: ["AI"],
        topicTitles: ["模型产品化"],
        sourceUrls: [],
        qualityScore: 88,
        publishStatus: "draft",
        dryRun: true,
        createdAt: "2026-05-30T00:00:00.000Z",
      }],
      sourcePerformance: [{
        url: "https://example.com/feed",
        group: "web",
        runs: 4,
        successes: 3,
        failures: 1,
        empty: 0,
        totalArticles: 12,
        lastStatus: "succeeded",
        updatedAt: "2026-05-30T00:00:00.000Z",
      }],
      recentFeedback: [{
        runId: "run-1",
        profileId: "profile-1",
        accountId: "main",
        rating: "bad",
        note: "标题太像 AI 速递",
        createdAt: "2026-05-30T00:00:00.000Z",
        updatedAt: "2026-05-30T00:00:00.000Z",
      }],
      recentTopicFeedback: [{
        runId: "run-1",
        profileId: "profile-1",
        accountId: "main",
        topicId: "topic-1",
        action: "skip",
        title: "泛泛 AI 快讯",
        reason: "没有读者收益",
        createdAt: "2026-05-30T00:00:00.000Z",
        updatedAt: "2026-05-30T00:00:00.000Z",
      }],
    },
  });

  assertEquals(snapshot.accountId, "main");
  assertEquals(snapshot.memoryScope, "account-strict");
  assertEquals(snapshot.profile.completenessScore, 100);
  assertEquals(snapshot.feedback.counts.bad, 1);
  assertEquals(snapshot.topicFeedback.counts.skip, 1);
  assertEquals(snapshot.sourceSignals[0].successRate, 75);
  assertEquals(
    snapshot.appliedGuidance.some((item) => item.includes("规避差反馈")),
    true,
  );
  assertEquals(
    snapshot.deterministicRules.some((item) => item.includes("硬降级")),
    true,
  );
});
