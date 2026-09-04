import { WeixinTemplate } from "@src/features/weixin-article/domain/renderable-article.ts";
import type { ArticlePlan } from "@src/features/weixin-article/domain/article-plan.ts";
import {
  getChineseNewsroomStyleGuide,
  PromptProfileName,
  resolvePromptProfile,
} from "@src/prompts/prompt-profile.ts";
import { formatAccountBrandGuide } from "@src/prompts/account-brand.ts";
import type { JsonObject } from "@src/core/ports/runtime-config-store.ts";

export function getDynamicHtmlSystemPrompt(
  promptProfile?: PromptProfileName,
  accountBrand?: JsonObject,
): string {
  const profile = resolvePromptProfile(promptProfile);
  const newsroomStyle = getChineseNewsroomStyleGuide(promptProfile);
  const brandGuide = formatAccountBrandGuide(accountBrand);
  return `你是中文公众号的资深排版编辑。你需要根据文章内容生成适合微信公众号编辑器粘贴的 HTML。

目标读者：
- ${profile.audience}。

当前内容定位：${profile.label}。
${brandGuide}

${newsroomStyle}

编辑原则：
1. 先让读者快速抓住本期最重要的信息：第一屏必须有新闻钩子，不要只写栏目名。
2. 版式要服务内容，不要把每篇文章套成完全相同的卡片。
3. 风格要求：${profile.editorialTone}。
4. 不新增事实，不改写原文观点，不编造来源、数据、作者或链接。
5. 可以做归纳、分段、强调和节奏调整，但不能增加原文没有的信息。

硬性要求：
1. 只返回 JSON：{"html":"...","theme":"...","notes":"..."}。
2. html 必须是微信公众号正文片段，根节点必须是 <section>。
3. 禁止使用 html、head、body、style、script、svg、div 标签。
4. 禁止使用 class、id、onclick 等事件属性。
5. 所有样式必须写在内联 style 属性中。
6. 使用 section、p、span、strong、em、img、sup 等微信兼容标签。
7. 外部链接不要做成可点击链接，可以在正文中保留来源文字。
8. 图片必须保留原始 src，使用 <img src="..." alt="..." style="max-width:100%;display:block;margin:...;" />。
9. 不要使用 table、iframe、video、canvas、form、input。

排版策略：
0. 当前 profile 版式口径：${profile.layoutGuidance}
0.1 当前 profile 成文角度：
${profile.contentAngles.map((item) => `   - ${item}`).join("\n")}
1. 根据文章组合选择主题，不要固定一种模板：
   - 速报：紧凑目录 + 每条 2-3 段 + 关键影响
   - 深度观察：引言 + 分节长文 + 观察点
   - 产品/工具：变化点 + 适用人群 + 使用价值
   - 工程/开源：问题场景 + 技术亮点 + 适合谁用
   - 商业/公司：事件 + 背后信号 + 后续影响
2. 每篇文章的内部结构可以不同，但全篇视觉系统要统一。
3. 开头可以使用一句编辑判断或新闻钩子，但不要写空泛欢迎语，也不要固定写“本期看点”。
4. 自动识别 1-3 个核心观点，用轻量 callout 强调；callout 必须短、具体、有信息量，不能写成“值得关注”。
5. 列表不要使用 ul/ol/li，使用 section + p 模拟列表。
6. 多图内容可生成 gallery 风格 section，但仍使用普通 img 标签。
7. 控制装饰密度：单篇文章最多一个重点块，整体最多 3 个重点块。
8. 字号层级清晰：主标题 24-28px，小标题 17-21px，正文 15-16px，辅助信息 12-13px。
9. 色彩不超过 3 个主色，优先使用黑白灰 + 一个强调色；不要整篇都用蓝紫科技渐变。
10. 每篇结尾可以有“来源”或“观察点”，不要生成外链按钮。

输出 JSON 的 theme 应简短说明本次版式方向，例如：
"minimal-brief"、"product-digest"、"engineering-notes"、"market-watch"、"longform-analysis"。`;
}

export function getDynamicHtmlUserPrompt(
  articles: WeixinTemplate[],
  promptProfile?: PromptProfileName,
  articlePlan?: ArticlePlan,
  accountBrand?: JsonObject,
): string {
  const profile = resolvePromptProfile(promptProfile);
  const newsroomStyle = getChineseNewsroomStyleGuide(promptProfile);
  const brandGuide = formatAccountBrandGuide(accountBrand);
  const compactArticles = articles.map((article, index) => ({
    index: index + 1,
    title: article.title,
    publishDate: article.publishDate,
    url: article.url,
    keywords: article.keywords || [],
    content: compactText(article.content, 1800),
    media: (article.media || []).map((media) => ({
      url: media.url,
      type: media.type,
      size: media.size,
    })),
  }));

  const planBlock = articlePlan
    ? `
文章计划（优先遵循）：
${JSON.stringify(compactArticlePlan(articlePlan), null, 2)}
`
    : "";

  return `请根据以下文章列表生成一整篇微信公众号 HTML。

当前内容定位：${profile.label}
目标读者：${profile.audience}
版式口径：${profile.layoutGuidance}
成文角度：
${profile.contentAngles.map((item) => `- ${item}`).join("\n")}
${brandGuide}

${newsroomStyle}

需要包含：
1. 一个有信息量的开篇标题区：不要只写“AI 快报”，要体现本期核心主题或最强新闻钩子。
2. 一个可快速浏览的导读区；如果素材少，可以用两三句编辑导语替代目录。
3. 每篇文章的标题、日期、正文和来源提示。
4. 根据内容添加少量重点提示块，但不要过度装饰。
5. 保留已有图片位置和原始图片 src。
6. 文章之间要有节奏差异，避免每篇都是同样的“标题 + 摘要 + callout”。
7. 如果文章数量少，排版应更像精选短评；如果文章数量多，排版应更像紧凑日报。
8. 如果提供了文章计划，必须优先遵循其中的主线观点、章节结构、标题方向、风险边界和配图意图。
9. 生成的中文要像编辑写稿，不要像模型汇总：少用“此外/同时/值得注意的是/总体来看”连续转场。

${planBlock}

文章数据：
${JSON.stringify(compactArticles, null, 2)}`;
}

function compactArticlePlan(plan: ArticlePlan) {
  return {
    format: plan.format,
    thesis: plan.thesis,
    targetReader: plan.targetReader,
    summary: plan.summary,
    sections: plan.sections.map((section) => ({
      id: section.id,
      title: section.title,
      intent: section.intent,
      angle: section.angle,
      articleIds: section.articleIds,
      keyPoints: section.keyPoints,
    })),
    titleDirections: plan.titleDirections,
    coverDirection: plan.coverDirection,
    bodyImagePlan: plan.bodyImagePlan,
    riskNotes: plan.riskNotes,
  };
}

function compactText(value: string, maxLength: number): string {
  const normalized = value
    .replace(/<next_paragraph\s*\/>/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength).trim()}...`;
}
