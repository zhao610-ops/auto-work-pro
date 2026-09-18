import { assertEquals } from "@std/assert";
import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { EditorialTopicReport } from "@src/features/weixin-article/domain/editorial-topic.ts";
import {
  TopicHeatService,
} from "@src/features/weixin-article/services/topic-heat.service.ts";

const contents: ScrapedContent[] = [
  {
    id: "a1",
    title: "即时零售订单增长",
    content: "平台披露订单增长与履约成本变化。",
    url: "https://retail.example/a1",
    publishDate: "2026-09-17T02:00:00.000Z",
    metadata: {},
  },
  {
    id: "a2",
    title: "即时零售履约模型调整",
    content: "第二家媒体交叉报道同一渠道变化。",
    url: "https://business.example/a2",
    publishDate: "2026-09-17T03:00:00.000Z",
    metadata: {},
  },
];

function report(): EditorialTopicReport {
  return {
    generatedAt: "2026-09-17T00:00:00.000Z",
    fallback: false,
    clusters: [{
      id: "topic-1",
      title: "即时零售履约模型调整",
      summary: "订单和履约成本出现同步变化。",
      keywords: ["即时零售", "履约"],
      articleIds: ["a1", "a2"],
      primaryArticleId: "a1",
      sourceCount: 2,
      freshness: 90,
      confidence: 80,
    }],
    scores: [{
      topicId: "topic-1",
      novelty: 80,
      relevance: 90,
      impact: 80,
      evidence: 85,
      actionability: 88,
      saturation: 10,
      risk: 10,
      finalScore: 80,
      reason: "可用于渠道经营和履约策略复盘。",
      recommendedUse: "lead",
    }],
  };
}

Deno.test("主题热度将多源时效与外部报道量纳入主线分数", async () => {
  const service = new TopicHeatService({
    enableExternal: true,
    now: () => new Date("2026-09-17T04:00:00.000Z"),
    fetchFn: () =>
      Promise.resolve(
        new Response(JSON.stringify({
          timeline: [{ data: [{ value: 12 }, { value: 8 }] }],
        })),
      ),
  });
  const enriched = await service.enrich(report(), contents);
  const score = enriched.scores[0];

  assertEquals(score.eligibleForLead, true);
  assertEquals((score.heat ?? 0) > 50, true);
  assertEquals((score.businessValue ?? 0) >= 80, true);
  assertEquals(score.recommendedUse, "lead");
});

Deno.test("证据或落地性不足的热点不能成为主线", async () => {
  const lowValue = report();
  lowValue.scores[0].evidence = 30;
  lowValue.scores[0].actionability = 40;
  const enriched = await new TopicHeatService({
    now: () => new Date("2026-09-17T04:00:00.000Z"),
  }).enrich(lowValue, contents);

  assertEquals(enriched.scores[0].eligibleForLead, false);
  assertEquals(enriched.scores[0].recommendedUse, "skip");
  assertEquals(enriched.scores[0].finalScore <= 39, true);
});

Deno.test("全球宏观和头部企业信号会获得额外热度权重", async () => {
  const base = await new TopicHeatService({
    now: () => new Date("2026-09-17T04:00:00.000Z"),
  }).enrich(report(), contents);
  const globalReport = report();
  globalReport.clusters[0] = {
    ...globalReport.clusters[0],
    title: "美联储政策与英伟达芯片投资改变全球供应链预期",
    keywords: ["Federal Reserve", "Nvidia", "semiconductor", "supply chain"],
  };
  const globalContents = contents.map((item, index) => ({
    ...item,
    title: index === 0
      ? "Federal Reserve signals policy shift as Nvidia expands chip investment"
      : "Global semiconductor supply chain reacts to Nvidia spending",
    url: index === 0
      ? "https://reuters.example/fed-nvidia"
      : "https://ft.example/chips",
  }));
  const enriched = await new TopicHeatService({
    now: () => new Date("2026-09-17T04:00:00.000Z"),
  }).enrich(globalReport, globalContents);

  assertEquals(
    (enriched.scores[0].heat ?? 0) > (base.scores[0].heat ?? 0),
    true,
  );
});
