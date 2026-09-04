import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { EditorialMemoryContext } from "@src/core/ports/editorial-memory-store.ts";
import type { EditorialTopicReport } from "@src/features/weixin-article/domain/editorial-topic.ts";
import {
  getChineseNewsroomStyleGuide,
  PromptProfileName,
  resolvePromptProfile,
} from "@src/prompts/prompt-profile.ts";
import { formatAccountBrandGuide } from "@src/prompts/account-brand.ts";
import type { JsonObject } from "@src/core/ports/runtime-config-store.ts";

export function getEditorialDecisionSystemPrompt(
  promptProfile?: PromptProfileName,
  accountBrand?: JsonObject,
): string {
  const profile = resolvePromptProfile(promptProfile);
  const newsroomStyle = getChineseNewsroomStyleGuide(promptProfile);
  const brandGuide = formatAccountBrandGuide(accountBrand);
  return `你是中文内容产品的主编，负责在写作前做“编辑决策”。你的任务不是写正文，而是解释今天为什么写这个主题、跳过哪些主题、如何避免重复和低质量表达。

内容定位：${profile.label}
目标读者：${profile.audience}
编辑语气：${profile.editorialTone}
${brandGuide}

${newsroomStyle}

你必须遵守：
1. 只基于候选主题、文章、历史记忆和人工反馈做判断。
2. 不新增事实，不编造数据、结论、来源或链接。
3. 反馈为“差”的原因要被转化为本次写作的规避指令。
4. 不要为了追热点强行选低证据主题。
5. 选择主线时优先考虑“读者为什么会继续看”，不要只因为关键词热门而选择。
6. 输出必须是 JSON，不要 Markdown、代码围栏或 <think>。

JSON 结构必须是：
{
  "leadTopicId": "topic-1",
  "leadTopicTitle": "主线主题",
  "decisionSummary": "一句话说明今天为什么写这个",
  "whyThisNow": ["原因"],
  "selectedTopics": [
    { "topicId": "topic-1", "role": "lead|supporting|watch", "reason": "选择原因" }
  ],
  "skippedTopics": [
    { "topicId": "topic-2", "reason": "跳过原因" }
  ],
  "duplicationRisk": {
    "level": "low|medium|high",
    "reason": "与近期文章/反馈的重复风险",
    "avoidAngles": ["本次要避免的角度"]
  },
  "sourceJudgements": [
    { "url": "https://...", "role": "primary|supporting|reference-only|avoid", "reason": "来源使用判断" }
  ],
  "recommendedFormat": "daily-brief|deep-analysis|product-review|trend-analysis|tutorial|interview|mixed",
  "writingDirectives": ["正文写作指令"],
  "titleWarnings": ["标题避免项"]
}`;
}

export function getEditorialDecisionUserPrompt(
  topics: EditorialTopicReport,
  contents: ScrapedContent[],
  memory?: EditorialMemoryContext,
  accountBrand?: JsonObject,
): string {
  const brandGuide = formatAccountBrandGuide(accountBrand);
  return `请根据今日候选主题、文章材料和编辑记忆，做一次发布前编辑决策。

决策要求：
- 选择 1 个 lead topic；其他主题只能作为 supporting / watch，或跳过。
- lead topic 必须能形成新闻钩子：新鲜事实、明确影响对象、反差或后续变量至少满足一个。
- skippedTopics 必须解释为什么不写，常见原因包括重复、证据不足、风险高、读者价值弱、同质化高。
- duplicationRisk 必须参考近期文章和人工反馈。
- sourceJudgements 只评价本次候选文章 URL，不评价无关来源。
- recommendedFormat 要和素材形态匹配，不要默认日报。
- writingDirectives 要可执行，例如“先解释变化，再讲对开发者的影响”，不要写空泛原则。
- titleWarnings 要吸收人工反馈，比如“避免标题太泛”“不要夸大成行业转折”“不要固定 AI 速递标题”。 
${brandGuide}

今日主题：
${JSON.stringify(compactTopics(topics), null, 2)}

候选文章：
${JSON.stringify(compactArticles(contents), null, 2)}

编辑记忆：
${JSON.stringify(compactMemory(memory), null, 2)}`;
}

function compactTopics(topics: EditorialTopicReport) {
  return topics.clusters.map((cluster) => {
    const score = topics.scores.find((item) => item.topicId === cluster.id);
    return {
      id: cluster.id,
      title: cluster.title,
      summary: cluster.summary,
      keywords: cluster.keywords,
      articleIds: cluster.articleIds,
      sourceCount: cluster.sourceCount,
      freshness: cluster.freshness,
      confidence: cluster.confidence,
      score: score
        ? {
          finalScore: score.finalScore,
          recommendedUse: score.recommendedUse,
          reason: score.reason,
          saturation: score.saturation,
          risk: score.risk,
          evidence: score.evidence,
        }
        : undefined,
    };
  });
}

function compactArticles(contents: ScrapedContent[]) {
  return contents.map((content) => ({
    id: content.id,
    title: content.title,
    url: content.url,
    publishDate: content.publishDate,
    keywords: readKeywords(content.metadata),
    excerpt: content.content.slice(0, 700),
  }));
}

function compactMemory(memory?: EditorialMemoryContext) {
  if (!memory) {
    return {
      recentArticles: [],
      recentFeedback: [],
      recentTopicFeedback: [],
      sourcePerformance: [],
    };
  }
  return {
    recentArticles: memory.recentArticles.slice(0, 8).map((item) => ({
      accountId: item.accountId,
      title: item.title,
      thesis: item.thesis,
      keywords: item.keywords,
      qualityScore: item.qualityScore,
      publishStatus: item.publishStatus,
      createdAt: item.createdAt,
    })),
    recentFeedback: memory.recentFeedback.slice(0, 8).map((item) => ({
      accountId: item.accountId,
      rating: item.rating,
      note: item.note,
      updatedAt: item.updatedAt,
    })),
    recentTopicFeedback: memory.recentTopicFeedback.slice(0, 10).map((
      item,
    ) => ({
      accountId: item.accountId,
      action: item.action,
      topicId: item.topicId,
      title: item.title,
      reason: item.reason,
      updatedAt: item.updatedAt,
    })),
    sourcePerformance: memory.sourcePerformance.slice(0, 12).map((item) => ({
      url: item.url,
      group: item.group,
      runs: item.runs,
      successes: item.successes,
      failures: item.failures,
      empty: item.empty,
      totalArticles: item.totalArticles,
      lastStatus: item.lastStatus,
      lastError: item.lastError,
    })),
  };
}

function readKeywords(metadata: Record<string, unknown>): string[] {
  const value = metadata.keywords;
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(
      0,
      8,
    )
    : [];
}
