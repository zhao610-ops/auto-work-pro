import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { ArticlePlan } from "@src/features/weixin-article/domain/article-plan.ts";
import type { EditorialTopicReport } from "@src/features/weixin-article/domain/editorial-topic.ts";
import type { EvidencePack } from "@src/features/weixin-article/domain/evidence.ts";
import {
  getChineseNewsroomStyleGuide,
  PromptProfileName,
  resolvePromptProfile,
} from "@src/prompts/prompt-profile.ts";
import { formatAccountBrandGuide } from "@src/prompts/account-brand.ts";
import type { JsonObject } from "@src/core/ports/runtime-config-store.ts";

export function getQualityReviewSystemPrompt(
  promptProfile?: PromptProfileName,
  accountBrand?: JsonObject,
): string {
  const profile = resolvePromptProfile(promptProfile);
  const newsroomStyle = getChineseNewsroomStyleGuide(promptProfile);
  const brandGuide = formatAccountBrandGuide(accountBrand);
  return `你是中文公众号发布前的质量审稿人。你需要检查一篇即将发布的公众号文章是否可靠、清晰、合规。

目标读者：
- ${profile.audience}

当前内容定位：${profile.label}
${brandGuide}

${newsroomStyle}

审稿原则：
1. 只审稿，不重写全文。
2. 必须基于输入的来源文章、今日选题、Article Plan 和最终 HTML 判断。
3. 不新增事实，不臆测作者意图，不给泛泛而谈的建议。
4. 重点找会影响发布质量的问题：事实不一致、标题误导、结构偏离、公众号 HTML 不兼容、风险边界缺失。不要因“值得注意”等常见转场措辞或图片来源/相关性不明而扣分或阻断发布。
5. 检查文章是否真正服务账号定位和目标岗位，而不是仅仅属于宽泛的“商业”或“科技”话题。

硬性输出要求：
1. 只返回 JSON，不要 markdown，不要代码块。
2. JSON 必须包含：
{
  "overallScore": 0,
  "allowPublish": true,
  "recommendedAction": "publish|dry-run-only|revise|block",
  "summary": "...",
  "dimensionScores": {
    "factConsistency": 0,
    "titleQuality": 0,
    "structureQuality": 0,
    "expressionQuality": 0,
    "htmlCompliance": 0,
    "imageRelevance": 0,
    "riskHandling": 0
  },
  "issues": [
    {
      "id": "issue-1",
      "category": "fact|title|structure|tone|html|image|risk",
      "severity": "low|medium|high|blocker",
      "message": "...",
      "evidence": "...",
      "suggestion": "...",
      "autoFixable": true
    }
  ],
  "repairSuggestions": ["..."]
}

评分规则：
- 90-100：可发布，只存在轻微优化点。
- 80-89：基本可发布，有少量非阻断问题。
- 60-79：建议只 dry-run 或人工确认后发布。
- 40-59：需要修订。
- 0-39：禁止正式发布。
- blocker 或高危事实问题时 recommendedAction 必须为 block。
- 如果主题无法直接服务账号目标读者的工作判断，或者只是纯科技产品、AI 模型、Agent、开发者工具和一般科技公司动态，overallScore 最高 39，allowPublish 必须为 false，recommendedAction 必须为 block。

分类口径：
- fact：最终正文出现来源或计划不支持的事实、数字、结论。
- title：标题党、过度承诺、空泛、误导。
- structure：没有遵循 Article Plan，主线混乱，章节重复。
- tone：只评估严重的营销腔、重复啰嗦或无法理解的表达；“值得注意”等常见转场措辞不扣分。
- html：出现公众号不兼容标签或属性，例如 div、script、style、svg、class、id、on*。
- image：不作为评分或阻断依据，除非图片说明直接捏造事实。
- risk：不确定、争议、伦理、版权、医疗金融法律等风险没有谨慎表达；同时检查涉黄、赌博、毒品、暴力武器、诈骗洗钱、违规金融推广等不合规内容。

注意：
- 如果只是风格可以更好，不要给 high 或 blocker。
- 如果首屏没有让人继续读的具体信息点，expressionQuality 和 structureQuality 都应扣分。
- 如果标题仍是“AI速递/今日快报/行业观察”这类模板标题，titleQuality 应明显扣分。
- 标题下方不得出现“商业与产业 · 来源简报 | 日期”等栏目、模板类型或日期组合；出现时作为 html 问题要求删除。
- 微信公众号正文允许并依赖标签上的内联 style 属性；不要因为使用 style 属性或内联样式较多而扣分。这里禁止的是 <style> 标签，不是 style 属性。
- 如果无法从来源确认事实，应降低 factConsistency 并指出需要谨慎。
- issues 控制在 0-8 条，优先列出真正重要的问题。`;
}

export function getQualityReviewUserPrompt(
  input: {
    title: string;
    html: string;
    articlePlan: ArticlePlan;
    topicReport: EditorialTopicReport;
    contents: ScrapedContent[];
    evidencePack?: EvidencePack;
  },
  promptProfile?: PromptProfileName,
  accountBrand?: JsonObject,
): string {
  const profile = resolvePromptProfile(promptProfile);
  const newsroomStyle = getChineseNewsroomStyleGuide(promptProfile);
  const brandGuide = formatAccountBrandGuide(accountBrand);
  const compactContents = input.contents.map((content, index) => ({
    index: index + 1,
    id: content.id,
    title: content.title,
    url: content.url,
    publishDate: content.publishDate,
    excerpt: content.content.slice(0, 900),
  }));
  const compactTopicReport = {
    clusters: input.topicReport.clusters.map((cluster) => ({
      id: cluster.id,
      title: cluster.title,
      summary: cluster.summary,
      articleIds: cluster.articleIds,
    })),
    scores: input.topicReport.scores.map((score) => ({
      topicId: score.topicId,
      finalScore: score.finalScore,
      recommendedUse: score.recommendedUse,
      reason: score.reason,
      risk: score.risk,
    })),
  };
  const compactPlan = {
    format: input.articlePlan.format,
    thesis: input.articlePlan.thesis,
    summary: input.articlePlan.summary,
    sections: input.articlePlan.sections,
    titleDirections: input.articlePlan.titleDirections,
    riskNotes: input.articlePlan.riskNotes,
  };

  return `请审稿以下微信公众号文章。

当前内容定位：${profile.label}
目标读者：${profile.audience}
${brandGuide}

${newsroomStyle}

标题：
${input.title}

今日选题：
${JSON.stringify(compactTopicReport, null, 2)}

Article Plan：
${JSON.stringify(compactPlan, null, 2)}

来源文章：
${JSON.stringify(compactContents, null, 2)}

补充证据包：
${JSON.stringify(compactEvidencePack(input.evidencePack), null, 2)}

最终 HTML：
${input.html.slice(0, 16000)}`;
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
