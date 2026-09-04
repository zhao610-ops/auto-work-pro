import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { ArticlePlan } from "@src/features/weixin-article/domain/article-plan.ts";
import type { ArticleQualityReview } from "@src/features/weixin-article/domain/quality-review.ts";
import {
  getChineseNewsroomStyleGuide,
  PromptProfileName,
  resolvePromptProfile,
} from "@src/prompts/prompt-profile.ts";

export function getArticleRevisionSystemPrompt(
  promptProfile?: PromptProfileName,
): string {
  const profile = resolvePromptProfile(promptProfile);
  const newsroomStyle = getChineseNewsroomStyleGuide(promptProfile);
  return `你是中文公众号的谨慎修稿编辑。你只根据质量审稿报告中的可自动修复问题，对标题和 HTML 做最小必要修改。

目标读者：
- ${profile.audience}

当前内容定位：${profile.label}

${newsroomStyle}

修稿原则：
1. 只修复审稿报告里明确列入“允许修复”的问题，不自由发挥。
2. 不新增来源文章没有的信息，不新增数据、人物、结论或链接。
3. 不处理 high fact 或 blocker 问题；这类问题应留给人工或阻断发布。
4. 修改越少越好，优先修标题、首屏新闻钩子、措辞、风险提示、HTML 合规和可局部调整的结构问题。
5. 如果没有安全可修的问题，返回 applied=false，并保留原标题和原 HTML。
6. 修掉明显 AI 味时，只压缩和改写空泛句，不把文章改成另一个选题。

硬性输出：
1. 只返回 JSON，不要 markdown，不要代码块。
2. JSON 必须包含：
{
  "applied": true,
  "title": "...",
  "html": "...",
  "changes": [
    {
      "issueId": "...",
      "field": "title|html",
      "before": "...",
      "after": "...",
      "reason": "..."
    }
  ],
  "skippedIssueIds": ["..."],
  "notes": "..."
}

HTML 规则：
1. html 必须是完整微信公众号正文片段，根节点必须是 <section>。
2. 禁止 html/head/body/style/script/svg/div。
3. 禁止 class/id/on*。
4. 所有样式必须内联。
5. 如果只修标题，也必须原样返回 html 字段。`;
}

export function getArticleRevisionUserPrompt(
  input: {
    round: number;
    title: string;
    html: string;
    articlePlan: ArticlePlan;
    qualityReview: ArticleQualityReview;
    contents: ScrapedContent[];
  },
  promptProfile?: PromptProfileName,
): string {
  const profile = resolvePromptProfile(promptProfile);
  const newsroomStyle = getChineseNewsroomStyleGuide(promptProfile);
  const safeIssues = input.qualityReview.issues.filter(isSafeRevisionIssue);
  const compactContents = input.contents.map((content) => ({
    id: content.id,
    title: content.title,
    url: content.url,
    excerpt: content.content.slice(0, 700),
  }));
  const compactPlan = {
    format: input.articlePlan.format,
    thesis: input.articlePlan.thesis,
    summary: input.articlePlan.summary,
    sections: input.articlePlan.sections,
    titleDirections: input.articlePlan.titleDirections,
    riskNotes: input.articlePlan.riskNotes,
  };

  return `请执行第 ${input.round} 轮最小修稿。

当前内容定位：${profile.label}

${newsroomStyle}

只允许修复以下问题：
${JSON.stringify(safeIssues, null, 2)}

不要修复以下高风险问题，它们只用于理解边界：
${
    JSON.stringify(
      input.qualityReview.issues.filter((issue) => !safeIssues.includes(issue)),
      null,
      2,
    )
  }

当前标题：
${input.title}

Article Plan：
${JSON.stringify(compactPlan, null, 2)}

来源文章：
${JSON.stringify(compactContents, null, 2)}

当前 HTML：
${input.html.slice(0, 18000)}`;
}

function isSafeRevisionIssue(
  issue: ArticleQualityReview["issues"][number],
): boolean {
  if (issue.severity === "blocker") return false;
  if (issue.autoFixable) return true;
  return issue.category === "title" ||
    issue.category === "tone" ||
    issue.category === "structure" ||
    issue.category === "html";
}
