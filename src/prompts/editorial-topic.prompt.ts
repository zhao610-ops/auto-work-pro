import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { EditorialMemoryContext } from "@src/core/ports/editorial-memory-store.ts";
import {
  getChineseNewsroomStyleGuide,
  PromptProfileName,
  resolvePromptProfile,
} from "@src/prompts/prompt-profile.ts";
import { formatAccountBrandGuide } from "@src/prompts/account-brand.ts";
import type { JsonObject } from "@src/core/ports/runtime-config-store.ts";

export function getEditorialTopicSystemPrompt(
  promptProfile?: PromptProfileName,
  accountBrand?: JsonObject,
): string {
  const profile = resolvePromptProfile(promptProfile);
  const newsroomStyle = getChineseNewsroomStyleGuide(promptProfile);
  const brandGuide = formatAccountBrandGuide(accountBrand);
  return `你是中文公众号的资深选题主编，负责把候选文章聚类成“今天值得写的主题”，并判断每个主题的编辑价值。

内容定位：${profile.label}
目标读者：${profile.audience}
编辑语气：${profile.editorialTone}
${brandGuide}

${newsroomStyle}

你要完成两件事：
1. 把同一事件、同一产品、同一论文/项目、同一公司公告或同一趋势的文章合并成主题。
2. 给每个主题打分，决定它适合做主线、短讯、观察，还是跳过。

评分维度范围均为 0-100：
- novelty：新鲜度，是否有近期新增事实。
- relevance：与目标读者的相关性。
- impact：影响范围和行业信号强度。
- evidence：来源和内容证据充分度。
- actionability：是否能给读者带来判断、行动或启发；是否有新动作、新数字、反差、强影响对象或明确后续变量。
- saturation：同质化和写烂程度，越高越不该写。
- risk：事实不确定性、争议或误导风险，越高越要谨慎。
- finalScore：综合推荐分。

推荐用途：
- lead：适合做今日主线。
- brief：适合做短讯或合集条目。
- watch：值得观察但不适合下结论。
- skip：不建议写。

适合写成文章的角度：
${profile.contentAngles.map((item) => `- ${item}`).join("\n")}

低价值信号：
${profile.lowValueSignals.map((item) => `- ${item}`).join("\n")}

只输出 JSON，不要 Markdown、解释、代码围栏或 <think>。JSON 结构必须是：
{
  "clusters": [
    {
      "id": "topic-1",
      "title": "主题标题",
      "summary": "主题摘要",
      "keywords": ["关键词"],
      "articleIds": ["文章ID"],
      "primaryArticleId": "文章ID",
      "sourceCount": 1,
      "freshness": 80,
      "confidence": 85
    }
  ],
  "scores": [
    {
      "topicId": "topic-1",
      "novelty": 80,
      "relevance": 90,
      "impact": 75,
      "evidence": 85,
      "actionability": 70,
      "saturation": 20,
      "risk": 15,
      "finalScore": 84,
      "reason": "推荐理由",
      "recommendedUse": "lead"
    }
  ]
}`;
}

export function getEditorialTopicUserPrompt(
  contents: ScrapedContent[],
  maxTopics = 8,
  memory?: EditorialMemoryContext,
  accountBrand?: JsonObject,
): string {
  const brandGuide = formatAccountBrandGuide(accountBrand);
  return `请把下面候选文章聚类成最多 ${maxTopics} 个主题，并给每个主题评分。

规则：
- 每篇文章最多只能归入一个主题。
- 同主题多来源时，选择信息量最高的一篇作为 primaryArticleId。
- 如果文章质量很低，可以不归入任何主题。
- 不要新增事实，不要改写文章观点。
- title 要像编辑选题标题，不要照抄营销标题。
- title 不要写成“AI速递”“今日快报”“行业观察”这类栏目名，要体现主题的新鲜点。
- 如果近期文章记忆中出现过相同主题或相同角度，应降低 saturation、避免重复主线；除非今天有明确新事实。
- 人工反馈优先级高于一般偏好：近期“跳过”的相似主题必须降为 skip；近期“锁主线/采用”的相似主题只能在当前候选有充分证据时提高优先级，不能替代事实证据。
- 近期差评说明是强规避项；如果差评指出标题空泛、缺少读者收益、AI 味重或重复角度，本次选题理由必须主动避开这些问题。
- 来源表现只作为输入质量参考，不要把来源统计当作文章事实写进正文。

${formatEditorialMemory(memory)}
${brandGuide}

候选文章：
${
    contents.map((content, index) => (
      `序号: ${index + 1}\n` +
      `文章ID: ${content.id}\n` +
      `标题: ${content.title}\n` +
      `URL: ${content.url}\n` +
      `发布时间: ${content.publishDate || "未知"}\n` +
      `来源信息: ${JSON.stringify(content.metadata ?? {})}\n` +
      `内容摘要:\n${content.content.slice(0, 2200)}\n` +
      `---`
    )).join("\n\n")
  }`;
}

function formatEditorialMemory(memory?: EditorialMemoryContext): string {
  if (
    !memory ||
    (!memory.recentArticles.length && !memory.sourcePerformance.length &&
      !memory.recentTopicFeedback.length)
  ) {
    return "近期编辑记忆：暂无。";
  }

  const recent = memory.recentArticles.slice(0, 8).map((article, index) => {
    const score = article.qualityScore === undefined
      ? "未知"
      : String(article.qualityScore);
    const keywords = article.keywords.slice(0, 6).join("、") || "无";
    const account = article.accountId ? ` | 账号: ${article.accountId}` : "";
    return `${index + 1}. ${article.title}${account} | 主线: ${
      article.thesis || "未记录"
    } | 关键词: ${keywords} | 质量分: ${score} | 状态: ${article.publishStatus}`;
  }).join("\n");

  const sources = memory.sourcePerformance.slice(0, 10).map((source) => {
    const effective = source.runs > 0
      ? Math.round((source.successes / source.runs) * 100)
      : 0;
    return `- ${source.group} ${source.url}: 成功率 ${effective}%, 有效文章 ${source.totalArticles}, 最近状态 ${source.lastStatus}${
      source.lastError ? `, 最近错误 ${source.lastError}` : ""
    }`;
  }).join("\n");

  const feedback = memory.recentFeedback.slice(0, 8).map((item, index) => {
    const label = item.rating === "good"
      ? "好"
      : item.rating === "bad"
      ? "差"
      : "一般";
    const account = item.accountId ? `账号 ${item.accountId}，` : "";
    return `${index + 1}. ${account}${label}: ${item.note || "未填写原因"}`;
  }).join("\n");

  const topicFeedback = memory.recentTopicFeedback.slice(0, 10).map((
    item,
    index,
  ) => {
    const action = item.action === "lead"
      ? "锁主线"
      : item.action === "adopt"
      ? "采用"
      : "跳过";
    const account = item.accountId ? `账号 ${item.accountId}，` : "";
    const title = item.title || item.topicId;
    return `${index + 1}. ${account}${action}: ${title}${
      item.reason ? `，原因：${item.reason}` : ""
    }`;
  }).join("\n");

  return `近期编辑记忆：
${recent || "暂无历史文章。"}

人工反馈：
${feedback || "暂无人工反馈。"}

主题人工取舍：
${topicFeedback || "暂无主题级取舍。"}

来源表现摘要：
${sources || "暂无来源表现。"}
`;
}
