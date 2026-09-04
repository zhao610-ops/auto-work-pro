import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { ArticlePlanFormat } from "@src/features/weixin-article/domain/article-plan.ts";
import type { EditorialDecision } from "@src/features/weixin-article/domain/editorial-decision.ts";
import type { EditorialTopicReport } from "@src/features/weixin-article/domain/editorial-topic.ts";
import type { EvidencePack } from "@src/features/weixin-article/domain/evidence.ts";
import {
  getChineseNewsroomStyleGuide,
  PromptProfileName,
  resolvePromptProfile,
} from "@src/prompts/prompt-profile.ts";
import { formatAccountBrandGuide } from "@src/prompts/account-brand.ts";
import type { JsonObject } from "@src/core/ports/runtime-config-store.ts";

export function getArticlePlanSystemPrompt(
  promptProfile?: PromptProfileName,
  accountBrand?: JsonObject,
): string {
  const profile = resolvePromptProfile(promptProfile);
  const newsroomStyle = getChineseNewsroomStyleGuide(promptProfile);
  const brandGuide = formatAccountBrandGuide(accountBrand);
  return `你是中文内容产品的资深主编。你需要在正文生成前，根据今日选题和已处理文章生成一份结构化 Article Plan。

目标读者：
- ${profile.audience}

当前内容定位：${profile.label}
${brandGuide}

编辑口径：
- ${profile.editorialTone}
- ${profile.layoutGuidance}

${newsroomStyle}

任务目标：
1. 从主题层判断今天应该怎么写，而不是简单拼接每篇文章。
2. 明确一条主线观点，让正文围绕主线展开；如果素材不够支撑主线，就明确写成精选短评。
3. 给出章节安排、标题方向、封面方向、正文配图意图和风险边界。
4. 不新增事实，不编造数据、来源、结论或链接。

硬性输出要求：
1. 只返回 JSON，不要 markdown，不要代码块。
2. JSON 必须包含这些字段：
{
  "format": "daily-brief|deep-analysis|product-review|trend-analysis|tutorial|interview|mixed",
  "thesis": "...",
  "targetReader": "...",
  "summary": "...",
  "sections": [
    {
      "id": "section-1",
      "title": "...",
      "intent": "...",
      "angle": "...",
      "articleIds": ["..."],
      "keyPoints": ["..."]
    }
  ],
  "titleDirections": [
    { "title": "...", "angle": "...", "reason": "..." }
  ],
  "coverDirection": {
    "visualBrief": "...",
    "textBrief": "...",
    "mood": "..."
  },
  "bodyImagePlan": {
    "enabled": true,
    "placements": [
      {
        "sectionId": "section-1",
        "purpose": "...",
        "promptHint": "..."
      }
    ]
  },
  "riskNotes": [
    { "level": "low|medium|high", "issue": "...", "handling": "..." }
  ]
}

规划原则：
1. format 要根据内容选择，不要默认科技日报：
   - 多个短消息：daily-brief
   - 一个主线事件且信息充分：deep-analysis 或 trend-analysis
   - 工具、产品、模型、平台能力更新：product-review
   - 教程、实践路径、操作指南：tutorial
   - 对话或连续问答内容：interview
   - 主题分散但都值得提：mixed
2. sections 控制在 3-6 个，必须引用真实 articleIds。
3. titleDirections 给 3 个方向，必须像真实媒体标题：具体、短、有新闻钩子；禁止“AI速递”“今日快报”“一文看懂”等模板标题。
4. coverDirection 应该能直接指导图片生成，不要只写“科技感”。
5. bodyImagePlan 只规划真正有助于理解的图片，不要为了装饰配图。
6. riskNotes 必须指出不确定信息、单一来源、商业宣传、伦理争议或需要谨慎表述的点。
7. summary 必须说明读者为什么要看这篇：新鲜点、影响对象、后续变量三者至少出现两个。
8. 如果素材质量不足，要在 summary 和 riskNotes 里说明，不要硬凑深度。
9. 商业状态、定价、付费/免费、API 是否开放、deprecated/legacy、替代关系、发布时间、参数规格，只有来源摘录或补充证据明确写出时才能放进 thesis、section title 或 keyPoints；否则必须写成“待确认/尚未披露”。
10. section 的标题和 keyPoints 必须能被该 section.articleIds 对应的文章摘录支撑；如果只是 topic/搜索词里出现、但正文摘录没出现，不要把它作为章节主轴。`;
}

export function getArticlePlanUserPrompt(
  topics: EditorialTopicReport,
  contents: ScrapedContent[],
  promptProfile?: PromptProfileName,
  decision?: EditorialDecision,
  evidencePack?: EvidencePack,
  accountBrand?: JsonObject,
): string {
  const profile = resolvePromptProfile(promptProfile);
  const newsroomStyle = getChineseNewsroomStyleGuide(promptProfile);
  const brandGuide = formatAccountBrandGuide(accountBrand);
  const compactTopics = topics.clusters.map((cluster) => {
    const score = topics.scores.find((item) => item.topicId === cluster.id);
    return {
      id: cluster.id,
      title: cluster.title,
      summary: cluster.summary,
      keywords: cluster.keywords,
      articleIds: cluster.articleIds,
      primaryArticleId: cluster.primaryArticleId,
      sourceCount: cluster.sourceCount,
      score: score
        ? {
          finalScore: score.finalScore,
          recommendedUse: score.recommendedUse,
          reason: score.reason,
          risk: score.risk,
          evidence: score.evidence,
        }
        : undefined,
    };
  });
  const compactArticles = contents.map((content, index) => ({
    index: index + 1,
    id: content.id,
    title: content.title,
    url: content.url,
    publishDate: content.publishDate,
    keywords: readKeywords(content.metadata),
    excerpt: content.content.slice(0, 900),
  }));

  return `请为本次微信文章生成 Article Plan。

当前内容定位：${profile.label}
目标读者：${profile.audience}
成文角度：
${profile.contentAngles.map((item) => `- ${item}`).join("\n")}
${brandGuide}

${newsroomStyle}

今日选题：
${JSON.stringify(compactTopics, null, 2)}

编辑决策：
${JSON.stringify(compactDecision(decision), null, 2)}

已处理文章：
${JSON.stringify(compactArticles, null, 2)}

补充证据包：
${JSON.stringify(compactEvidencePack(evidencePack), null, 2)}

生成前请做一次事实边界自检：
- 不要把搜索 query、topic title、编辑决策里的推测当成事实。
- 每个 section.title 和 keyPoints 必须能从对应 articleIds 的 excerpt 或补充证据 summary 中找到直接依据。
- 如果只看到列表页标题、没有完整正文，就把它写成“看到官方列表页出现该条目”，不要补出 API、计费、替代、参数等细节。`;
}

export function isArticlePlanFormat(value: string): value is ArticlePlanFormat {
  return [
    "daily-brief",
    "deep-analysis",
    "product-review",
    "trend-analysis",
    "tutorial",
    "interview",
    "mixed",
  ].includes(value);
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

function compactDecision(decision?: EditorialDecision) {
  if (!decision) {
    return {
      available: false,
      note: "暂无编辑决策，请基于主题评分保守规划。",
    };
  }
  return {
    available: true,
    leadTopicId: decision.leadTopicId,
    leadTopicTitle: decision.leadTopicTitle,
    decisionSummary: decision.decisionSummary,
    whyThisNow: decision.whyThisNow,
    selectedTopics: decision.selectedTopics,
    skippedTopics: decision.skippedTopics,
    duplicationRisk: decision.duplicationRisk,
    recommendedFormat: decision.recommendedFormat,
    writingDirectives: decision.writingDirectives,
    titleWarnings: decision.titleWarnings,
  };
}

function compactEvidencePack(evidencePack?: EvidencePack) {
  if (!evidencePack?.items.length) {
    return {
      available: false,
      skippedReason: evidencePack?.skippedReason ?? "未提供补充证据",
      gaps: evidencePack?.gaps ?? [],
    };
  }
  return {
    available: true,
    topic: evidencePack.topic,
    queries: evidencePack.queries,
    items: evidencePack.items.map((item) => ({
      title: item.title,
      url: item.url,
      sourceType: item.sourceType,
      confidence: item.confidence,
      supports: item.supports,
      summary: item.summary.slice(0, 700),
    })),
    gaps: evidencePack.gaps,
  };
}
