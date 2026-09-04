import { assertEquals } from "@std/assert";
import type { LLMProvider } from "@src/core/ports/llm.ts";
import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { EditorialTopicReport } from "@src/features/weixin-article/domain/editorial-topic.ts";
import {
  normalizeEditorialDecision,
  WeixinArticleEditorialDecisionService,
} from "@src/features/weixin-article/services/editorial-decision.service.ts";

const contents: ScrapedContent[] = [
  {
    id: "a1",
    title: "OpenAI 发布新模型",
    content: "OpenAI 发布新模型，面向开发者提供更低延迟。",
    url: "https://example.com/a1",
    publishDate: "2026-05-23",
    metadata: { keywords: ["OpenAI", "模型"] },
  },
  {
    id: "a2",
    title: "API 成本下降",
    content: "同一轮模型更新带来 API 成本下降。",
    url: "https://example.com/a2",
    publishDate: "2026-05-23",
    metadata: {},
  },
];

const topicReport: EditorialTopicReport = {
  generatedAt: "2026-05-23T00:00:00.000Z",
  fallback: false,
  clusters: [{
    id: "topic-openai",
    title: "OpenAI 模型更新影响开发者成本",
    summary: "模型能力和 API 价格构成同一主题。",
    keywords: ["OpenAI", "API"],
    articleIds: ["a1", "a2"],
    primaryArticleId: "a1",
    sourceCount: 2,
    freshness: 90,
    confidence: 88,
  }],
  scores: [{
    topicId: "topic-openai",
    novelty: 90,
    relevance: 92,
    impact: 86,
    evidence: 88,
    actionability: 80,
    saturation: 20,
    risk: 15,
    finalScore: 89,
    reason: "影响开发者成本和产品选择。",
    recommendedUse: "lead",
  }],
};

function createService(content: string): WeixinArticleEditorialDecisionService {
  const llm: LLMProvider = {
    initialize: () => Promise.resolve(),
    refresh: () => Promise.resolve(),
    setModel: () => {},
    createChatCompletion: () =>
      Promise.resolve({
        choices: [{ message: { content } }],
      }),
  };
  return new WeixinArticleEditorialDecisionService(llm);
}

function createServiceWithPromptCapture(
  content: string,
  prompts: string[],
): WeixinArticleEditorialDecisionService {
  const llm: LLMProvider = {
    initialize: () => Promise.resolve(),
    refresh: () => Promise.resolve(),
    setModel: () => {},
    createChatCompletion: (messages) => {
      prompts.push(...messages.map((message) => String(message.content)));
      return Promise.resolve({
        choices: [{ message: { content } }],
      });
    },
  };
  return new WeixinArticleEditorialDecisionService(llm, undefined, {
    displayName: "AI 产品观察",
    positioning: "面向产品经理解释 AI 产品变化",
    audience: "AI 产品经理",
    tone: "克制、有判断",
    titleStyle: "少用速递，多用具体变化",
  });
}

Deno.test("editorial decision service returns normalized AI decision", async () => {
  const service = createService(JSON.stringify({
    leadTopicId: "topic-openai",
    leadTopicTitle: "OpenAI 模型更新影响开发者成本",
    decisionSummary: "今天写模型更新，是因为它同时影响能力和成本。",
    whyThisNow: ["新模型发布", "API 成本下降"],
    selectedTopics: [{
      topicId: "topic-openai",
      role: "lead",
      reason: "证据和读者价值都较高。",
    }],
    skippedTopics: [],
    duplicationRisk: {
      level: "low",
      reason: "近期没有相同角度。",
      avoidAngles: ["避免空泛标题"],
    },
    sourceJudgements: [{
      url: "https://example.com/a1",
      role: "primary",
      reason: "信息量最高。",
    }],
    recommendedFormat: "deep-analysis",
    writingDirectives: ["先讲变化，再讲影响。"],
    titleWarnings: ["不要写成行业巨变。"],
  }));

  const decision = await service.createEditorialDecision(topicReport, contents);

  assertEquals(decision.fallback, false);
  assertEquals(decision.leadTopicId, "topic-openai");
  assertEquals(decision.recommendedFormat, "deep-analysis");
  assertEquals(decision.sourceJudgements[0].role, "primary");
});

Deno.test("editorial decision service falls back when LLM output is invalid", async () => {
  const service = createService("not json");

  const decision = await service.createEditorialDecision(topicReport, contents);

  assertEquals(decision.fallback, true);
  assertEquals(decision.leadTopicId, "topic-openai");
  assertEquals(decision.selectedTopics[0].role, "lead");
});

Deno.test("editorial decision service passes account brand guide to prompt", async () => {
  const prompts: string[] = [];
  const service = createServiceWithPromptCapture(
    JSON.stringify({
      leadTopicId: "topic-openai",
      recommendedFormat: "mixed",
    }),
    prompts,
  );

  await service.createEditorialDecision(topicReport, contents);

  assertEquals(
    prompts.some((prompt) => prompt.includes("AI 产品观察")),
    true,
  );
  assertEquals(
    prompts.some((prompt) => prompt.includes("面向产品经理解释 AI 产品变化")),
    true,
  );
});

Deno.test("normalizeEditorialDecision filters invalid topic and source ids", () => {
  const decision = normalizeEditorialDecision(
    {
      leadTopicId: "missing",
      selectedTopics: [{ topicId: "missing", role: "lead" }],
      skippedTopics: [{ topicId: "missing", reason: "bad" }],
      sourceJudgements: [{ url: "https://bad.example", role: "primary" }],
    },
    topicReport,
    contents,
    false,
  );

  assertEquals(decision.leadTopicId, "topic-openai");
  assertEquals(decision.selectedTopics.length, 1);
  assertEquals(decision.skippedTopics.length, 0);
  assertEquals(decision.sourceJudgements.length, 0);
});
