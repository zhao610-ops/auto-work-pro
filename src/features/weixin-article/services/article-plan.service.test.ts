import { assertEquals, assertThrows } from "@std/assert";
import type { LLMProvider } from "@src/core/ports/llm.ts";
import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { EditorialDecision } from "@src/features/weixin-article/domain/editorial-decision.ts";
import type { EditorialTopicReport } from "@src/features/weixin-article/domain/editorial-topic.ts";
import {
  normalizeArticlePlan,
  WeixinArticlePlanService,
} from "@src/features/weixin-article/services/article-plan.service.ts";

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

const editorialDecision: EditorialDecision = {
  generatedAt: "2026-05-23T00:00:00.000Z",
  fallback: false,
  leadTopicId: "topic-openai",
  leadTopicTitle: "OpenAI 模型更新影响开发者成本",
  decisionSummary: "今天写模型更新，因为它同时影响能力和成本。",
  whyThisNow: ["新模型发布", "API 成本下降"],
  selectedTopics: [{
    topicId: "topic-openai",
    role: "lead",
    reason: "证据和读者价值都较高。",
  }],
  skippedTopics: [],
  duplicationRisk: {
    level: "low",
    reason: "近期没有同角度内容。",
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
};

function createService(content: string): WeixinArticlePlanService {
  const llm: LLMProvider = {
    initialize: () => Promise.resolve(),
    refresh: () => Promise.resolve(),
    setModel: () => {},
    createChatCompletion: () =>
      Promise.resolve({
        choices: [{ message: { content } }],
      }),
  };
  return new WeixinArticlePlanService(llm);
}

function createBrandedService(content: string): WeixinArticlePlanService {
  const llm: LLMProvider = {
    initialize: () => Promise.resolve(),
    refresh: () => Promise.resolve(),
    setModel: () => {},
    createChatCompletion: () =>
      Promise.resolve({
        choices: [{ message: { content } }],
      }),
  };
  return new WeixinArticlePlanService(llm, undefined, {
    audience: "AI 产品经理",
    titleStyle: "强调产品变化，不写速递",
  });
}

Deno.test("article plan service returns normalized AI plan", async () => {
  const service = createService(JSON.stringify({
    format: "deep-analysis",
    thesis: "OpenAI 的模型更新正在改变开发者成本结构。",
    targetReader: "AI 应用开发者",
    summary: "围绕模型能力、成本和风险组织正文。",
    sections: [{
      id: "section-1",
      title: "模型更新带来的直接变化",
      intent: "解释发生了什么",
      angle: "先讲能力，再讲成本",
      articleIds: ["a1", "a2", "missing"],
      keyPoints: ["延迟降低", "API 成本下降"],
    }],
    titleDirections: [{
      title: "OpenAI 新模型之后，开发者成本会怎么变",
      angle: "成本影响",
      reason: "贴近开发者决策。",
    }],
    coverDirection: {
      visualBrief: "抽象 API 控制台和成本曲线",
      textBrief: "模型更新与成本变化",
      mood: "专业、克制",
    },
    bodyImagePlan: {
      enabled: true,
      placements: [{
        sectionId: "section-1",
        purpose: "解释成本变化",
        promptHint: "API 调用成本曲线",
      }],
    },
    riskNotes: [{
      level: "medium",
      issue: "成本信息可能随区域和套餐变化。",
      handling: "正文中避免写成绝对结论。",
    }],
  }));

  const plan = await service.createArticlePlan(topicReport, contents);

  assertEquals(plan.fallback, false);
  assertEquals(plan.format, "deep-analysis");
  assertEquals(plan.sections[0].articleIds, ["a1", "a2"]);
  assertEquals(plan.bodyImagePlan.enabled, true);
  assertEquals(plan.riskNotes[0].level, "medium");
});

Deno.test("article plan service falls back when LLM output is invalid", async () => {
  const service = createService("not json");

  const plan = await service.createArticlePlan(topicReport, contents);

  assertEquals(plan.fallback, true);
  assertEquals(plan.sections.length, 1);
  assertEquals(plan.sourceArticleIds, ["a1", "a2"]);
});

Deno.test("article plan fallback uses editorial decision", async () => {
  const service = createService("not json");

  const plan = await service.createArticlePlan(
    topicReport,
    contents,
    editorialDecision,
  );

  assertEquals(plan.format, "deep-analysis");
  assertEquals(plan.thesis, editorialDecision.decisionSummary);
  assertEquals(plan.riskNotes[0].handling, "先讲变化，再讲影响。");
});

Deno.test("article plan fallback keeps account reader and title preference", async () => {
  const service = createBrandedService("not json");

  const plan = await service.createArticlePlan(
    topicReport,
    contents,
    editorialDecision,
  );

  assertEquals(plan.targetReader, "AI 产品经理");
  assertEquals(
    plan.titleDirections[0].reason.includes("强调产品变化，不写速递"),
    true,
  );
});

Deno.test("normalizeArticlePlan rejects plans without valid sections", () => {
  assertThrows(
    () =>
      normalizeArticlePlan(
        {
          sections: [{
            id: "section-1",
            title: "无效章节",
            articleIds: ["missing"],
          }],
        },
        topicReport,
        contents,
        false,
      ),
    Error,
    "文章计划缺少有效章节",
  );
});

Deno.test("normalizeArticlePlan grounds unsupported planned entities to source content", () => {
  const plan = normalizeArticlePlan(
    {
      format: "daily-brief",
      thesis: "Project Glasswing 是这次的核心主线。",
      summary: "Project Glasswing 联合多家企业推进安全基础设施。",
      sections: [{
        id: "section-1",
        title: "Project Glasswing 的工程影响",
        intent: "解释 Project Glasswing 为什么重要",
        angle: "从安全基础设施合作看",
        articleIds: ["a1"],
        keyPoints: ["Project Glasswing 已经有 12 家企业参与"],
      }],
      titleDirections: [{
        title: "Project Glasswing：工程团队现在能评估什么",
        angle: "工程评估",
        reason: "突出工程价值",
      }],
    },
    topicReport,
    contents,
    false,
  );

  assertEquals(plan.sections[0].title, "OpenAI 发布新模型");
  assertEquals(
    plan.sections[0].keyPoints[0],
    "OpenAI 发布新模型，面向开发者提供更低延迟。",
  );
  assertEquals(plan.titleDirections[0].title, "OpenAI 发布新模型");
  assertEquals(
    plan.riskNotes.some((note) => note.issue.includes("Project Glasswing")),
    true,
  );
});

Deno.test("normalizeArticlePlan downgrades evidence-sensitive deep plans when evidence is empty", () => {
  const plan = normalizeArticlePlan(
    {
      format: "deep-analysis",
      thesis: "OpenAI 前沿治理框架可用于 Agent 合规自查。",
      summary: "工程团队现在可以按第三方评估方法论做检查项。",
      sections: [{
        id: "section-1",
        title: "治理框架现在能查什么",
        intent: "给出 4 个检查项",
        angle: "合规自查",
        articleIds: ["a1"],
        keyPoints: ["检查项 1：是否需要第三方评估"],
      }],
    },
    topicReport,
    contents,
    false,
    undefined,
    editorialDecision,
    {
      topic: "OpenAI 前沿治理框架",
      generatedAt: "2026-05-30T00:00:00.000Z",
      queries: ["OpenAI 前沿治理框架"],
      items: [],
      gaps: [],
      skippedReason: "未获得可用补充证据",
    },
  );

  assertEquals(plan.format, "daily-brief");
  assertEquals(plan.sections[0].title, "OpenAI 发布新模型");
  assertEquals(plan.riskNotes[0].issue.includes("补充证据为空"), true);
});

Deno.test("normalizeArticlePlan downgrades analytical plans when evidence is empty", () => {
  const plan = normalizeArticlePlan(
    {
      format: "deep-analysis",
      thesis: "Codex Tax Agent 已经能改变工程团队的自动化流程。",
      summary: "这是一篇面向工程团队的产品深度分析。",
      sections: [{
        id: "section-1",
        title: "工程团队可以怎么用 Codex Tax Agent",
        intent: "分析可执行场景",
        angle: "从开发流程和自动化收益切入",
        articleIds: ["a1"],
        keyPoints: ["Codex Tax Agent 可以承担复杂工程任务"],
      }],
    },
    topicReport,
    contents,
    false,
    undefined,
    editorialDecision,
    {
      topic: "Codex Tax Agent",
      generatedAt: "2026-05-30T00:00:00.000Z",
      queries: ["Codex Tax Agent"],
      items: [],
      gaps: [],
      skippedReason: "未获得可用补充证据",
    },
  );

  assertEquals(plan.format, "daily-brief");
  assertEquals(plan.riskNotes[0].issue.includes("补充证据为空"), true);
});

Deno.test("normalizeArticlePlan downgrades analytical plans when evidence is weak or unrelated", () => {
  const plan = normalizeArticlePlan(
    {
      format: "product-review",
      thesis: "OpenAI 模型更新正在改变开发者成本结构。",
      summary: "从能力、成本和迁移路径做产品分析。",
      sections: [{
        id: "section-1",
        title: "模型更新带来的直接变化",
        intent: "分析开发者成本",
        angle: "产品迁移",
        articleIds: ["a1", "a2"],
        keyPoints: ["延迟降低", "API 成本下降"],
      }],
    },
    topicReport,
    contents,
    false,
    undefined,
    editorialDecision,
    {
      topic: "OpenAI 模型更新影响开发者成本",
      generatedAt: "2026-05-30T00:00:00.000Z",
      queries: ["OpenAI 模型更新影响开发者成本"],
      items: [{
        id: "e1",
        title: "Anthropic 发布安全报告",
        url: "https://example.com/anthropic",
        provider: "test",
        sourceType: "official",
        summary: "这篇报告讨论 Claude 安全策略。",
        supports: ["支持 Anthropic 安全路线的背景信息。"],
        confidence: "high",
      }],
      gaps: [],
    },
  );

  assertEquals(plan.format, "daily-brief");
  assertEquals(plan.riskNotes[0].issue.includes("缺少直接支持关系"), true);
});

Deno.test("normalizeArticlePlan keeps analytical plans with direct official evidence", () => {
  const plan = normalizeArticlePlan(
    {
      format: "deep-analysis",
      thesis: "OpenAI 模型更新正在改变开发者成本结构。",
      summary: "围绕模型能力、延迟和 API 成本组织正文。",
      sections: [{
        id: "section-1",
        title: "模型更新带来的直接变化",
        intent: "解释 OpenAI 模型更新如何影响开发者成本",
        angle: "先讲能力，再讲成本",
        articleIds: ["a1", "a2"],
        keyPoints: ["延迟降低", "API 成本下降"],
      }],
    },
    topicReport,
    contents,
    false,
    undefined,
    editorialDecision,
    {
      topic: "OpenAI 模型更新影响开发者成本",
      generatedAt: "2026-05-30T00:00:00.000Z",
      queries: ["OpenAI 模型更新影响开发者成本"],
      items: [{
        id: "e1",
        title: "OpenAI 模型更新降低 API 成本",
        url: "https://openai.com/news/model-update",
        provider: "test",
        sourceType: "official",
        summary: "OpenAI 说明这轮模型更新带来更低延迟，并影响开发者 API 成本。",
        supports: ["支持模型更新、低延迟和 API 成本下降这条文章主线。"],
        confidence: "high",
      }],
      gaps: [],
    },
  );

  assertEquals(plan.format, "deep-analysis");
});
