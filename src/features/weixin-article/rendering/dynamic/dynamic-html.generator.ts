import { WeixinTemplate } from "@src/features/weixin-article/domain/renderable-article.ts";
import { LLMProvider } from "@src/core/ports/llm.ts";
import { Logger } from "@zilla/logger";
import {
  getDynamicHtmlSystemPrompt,
  getDynamicHtmlUserPrompt,
} from "@src/features/weixin-article/rendering/dynamic/dynamic-html.prompt.ts";
import { postProcessDynamicHtml } from "@src/features/weixin-article/rendering/dynamic/html-post-processor.ts";
import { PromptProfileName } from "@src/prompts/prompt-profile.ts";
import type { WeixinArticleRenderContext } from "@src/features/weixin-article/services/article-render.service.ts";
import { createStructuredJsonCompletion } from "@src/utils/llm-structured-output.ts";
import type { JsonObject } from "@src/core/ports/runtime-config-store.ts";
import { ARTICLE_LLM_TIMEOUT_MS } from "@src/features/weixin-article/services/article-llm-budget.ts";

const logger = new Logger("weixin-dynamic-html-generator");

interface DynamicHtmlResponse {
  html: string;
  theme?: string;
  notes?: string;
}

export class WeixinDynamicHtmlGenerator {
  constructor(
    private llm: LLMProvider,
    private readonly promptProfile?: PromptProfileName,
    private readonly accountBrand?: JsonObject,
  ) {}

  public async generate(
    articles: WeixinTemplate[],
    context?: WeixinArticleRenderContext,
  ): Promise<string> {
    if (!articles.length) {
      throw new Error("动态模板生成需要至少一篇文章");
    }

    const messages = [
      {
        role: "system" as const,
        content: getDynamicHtmlSystemPrompt(
          this.promptProfile,
          this.accountBrand,
        ),
      },
      {
        role: "user" as const,
        content: getDynamicHtmlUserPrompt(
          articles,
          this.promptProfile,
          context?.articlePlan,
          this.accountBrand,
        ),
      },
    ];
    const generated = await createStructuredJsonCompletion<
      DynamicHtmlResponse,
      { html: string; theme?: string; footnotes: number }
    >({
      label: "动态微信模板",
      llm: this.llm,
      messages,
      chatOptions: {
        temperature: 0.6,
        max_tokens: 6000,
        timeoutMs: ARTICLE_LLM_TIMEOUT_MS.dynamicTemplate,
        maxAttempts: 2,
        response_format: { type: "json_object" },
      },
      maxAttempts: 1,
      normalize: (raw) => {
        if (!raw.html || typeof raw.html !== "string") {
          throw new Error("缺少 html 字段");
        }
        const result = postProcessDynamicHtml(raw.html);
        return {
          html: result.html,
          theme: raw.theme,
          footnotes: result.footnotes.length,
        };
      },
    });
    logger.info(
      `动态微信模板生成完成: theme=${
        generated.theme || "auto"
      }, footnotes=${generated.footnotes}`,
    );
    return generated.html;
  }
}
