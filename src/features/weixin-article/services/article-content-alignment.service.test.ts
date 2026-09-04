import { assertEquals } from "@std/assert";
import {
  alignArticleContentsForPlan,
} from "@src/features/weixin-article/services/article-content-alignment.service.ts";
import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { EditorialDecision } from "@src/features/weixin-article/domain/editorial-decision.ts";
import type { EvidencePack } from "@src/features/weixin-article/domain/evidence.ts";

Deno.test("alignArticleContentsForPlan promotes direct evidence for the selected lead topic", () => {
  const result = alignArticleContentsForPlan({
    processedContents: [
      content(
        "listing",
        "Gemma 4 登场",
        "https://deepmind.google/discover/blog/",
      ),
    ],
    editorialDecision: decision(),
    evidencePack: {
      topic: "六 Agent 分工：Co-Scientist 把 AI 辅助科研做成研究伙伴",
      generatedAt: "2026-05-30T00:00:00.000Z",
      queries: [],
      gaps: [],
      items: [{
        id: "co-scientist",
        title: "Co-Scientist: A multi-agent AI partner to accelerate research",
        url:
          "https://deepmind.google/blog/co-scientist-a-multi-agent-ai-partner-to-accelerate-research/",
        provider: "jina-search",
        sourceType: "official",
        summary: "Co-Scientist uses multiple agents to generate hypotheses.",
        supports: [
          "六 Agent 分工：Co-Scientist 把 AI 辅助科研做成研究伙伴",
        ],
        confidence: "high",
      }],
    },
  });

  assertEquals(result.map((item) => item.id), [
    "evidence_co-scientist",
    "listing",
  ]);
  assertEquals(result[0].metadata.source, "evidence-pack");
  assertEquals(result[0].metadata.confidence, "high");
});

Deno.test("alignArticleContentsForPlan does not duplicate evidence with the same URL", () => {
  const sameUrl =
    "https://deepmind.google/blog/co-scientist-a-multi-agent-ai-partner-to-accelerate-research/";
  const result = alignArticleContentsForPlan({
    processedContents: [content("co", "Co-Scientist", sameUrl)],
    editorialDecision: decision(),
    evidencePack: evidencePack(sameUrl),
  });

  assertEquals(result.map((item) => item.id), ["co"]);
});

Deno.test("alignArticleContentsForPlan does not promote official evidence without topic overlap", () => {
  const result = alignArticleContentsForPlan({
    processedContents: [
      content("listing", "Project Glasswing", "https://example.com/listing"),
    ],
    editorialDecision: decision(),
    evidencePack: {
      topic: "Project Glasswing",
      generatedAt: "2026-05-30T00:00:00.000Z",
      queries: [],
      gaps: [],
      items: [{
        id: "series-h",
        title: "Anthropic raises $65B in Series H funding",
        url: "https://www.anthropic.com/news/series-h",
        provider: "jina-search",
        sourceType: "official",
        summary: "Anthropic raised funding to expand compute for Claude.",
        supports: ["Anthropic funding"],
        confidence: "high",
      }],
    },
  });

  assertEquals(result.map((item) => item.id), ["listing"]);
});

function content(id: string, title: string, url: string): ScrapedContent {
  return {
    id,
    title,
    content: `${title} 正文`,
    url,
    publishDate: "2026-05-30T00:00:00.000Z",
    metadata: {},
  };
}

function decision(): EditorialDecision {
  return {
    generatedAt: "2026-05-30T00:00:00.000Z",
    fallback: false,
    leadTopicId: "topic-1",
    leadTopicTitle: "六 Agent 分工：Co-Scientist 把 AI 辅助科研做成研究伙伴",
    decisionSummary: "写 Co-Scientist 的六 Agent 分工。",
    whyThisNow: [],
    selectedTopics: [{
      topicId: "topic-1",
      role: "lead",
      reason: "Co-Scientist 六 Agent 分工有明确机制。",
    }],
    skippedTopics: [],
    duplicationRisk: {
      level: "low",
      reason: "无明显重复。",
      avoidAngles: [],
    },
    sourceJudgements: [],
    recommendedFormat: "deep-analysis",
    writingDirectives: [],
    titleWarnings: [],
  };
}

function evidencePack(url: string): EvidencePack {
  return {
    topic: "Co-Scientist",
    generatedAt: "2026-05-30T00:00:00.000Z",
    queries: [],
    gaps: [],
    items: [{
      id: "co-scientist",
      title: "Co-Scientist",
      url,
      provider: "jina-search",
      sourceType: "official",
      summary: "Co-Scientist evidence.",
      supports: ["Co-Scientist"],
      confidence: "high",
    }],
  };
}
