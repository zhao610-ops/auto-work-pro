import {
  ContentSummarizer,
  Summary,
} from "@src/core/ports/content-summarizer.ts";
import { LLMProvider } from "@src/core/ports/llm.ts";
import {
  getSummarizerSystemPrompt,
  getSummarizerUserPrompt,
  getTitleSystemPrompt,
  getTitleUserPrompt,
} from "@src/prompts/summarizer.prompt.ts";
import { RetryUtil } from "@src/utils/retry.util.ts";
import { Logger } from "@zilla/logger";
import { cleanLLMTitle } from "@src/utils/llm-output.ts";
import { PromptProfileName } from "@src/prompts/prompt-profile.ts";
import { createStructuredJsonCompletion } from "@src/utils/llm-structured-output.ts";

const logger = new Logger("ai-summarizer");

export class AISummarizer implements ContentSummarizer {
  constructor(
    private readonly llm: LLMProvider,
    private readonly promptProfile?: PromptProfileName,
  ) {
    logger.info("Summarizer使用统一LLM配置");
  }

  async summarize(
    content: string,
    options?: Record<string, any>,
  ): Promise<Summary> {
    if (!content) {
      throw new Error("Content is required for summarization");
    }

    const messages = [
      {
        role: "system" as const,
        content: getSummarizerSystemPrompt(this.promptProfile),
      },
      {
        role: "user" as const,
        content: getSummarizerUserPrompt({
          content,
          language: options?.language,
          minLength: options?.minLength,
          maxLength: options?.maxLength,
          promptProfile: this.promptProfile,
        }),
      },
    ];
    return await createStructuredJsonCompletion<Summary, Summary>({
      label: "摘要",
      llm: this.llm,
      messages,
      chatOptions: {
        temperature: 0.7,
        response_format: { type: "json_object" },
      },
      maxAttempts: 2,
      normalize: (summary) => {
        if (
          !summary.title ||
          !summary.content
        ) {
          throw new Error("摘要结果格式不正确");
        }
        return summary;
      },
    });
  }

  async generateTitle(
    content: string,
    options?: Record<string, any>,
  ): Promise<string> {
    return RetryUtil.retryOperation(async () => {
      const response = await this.llm.createChatCompletion([
        {
          role: "system",
          content: getTitleSystemPrompt(this.promptProfile),
        },
        {
          role: "user",
          content: getTitleUserPrompt({
            content,
            language: options?.language,
            promptProfile: this.promptProfile,
          }),
        },
      ], {
        temperature: 0.7,
        max_tokens: 100,
      });

      const title = response.choices[0]?.message?.content;
      if (!title) {
        throw new Error("未获取到有效的标题");
      }
      const cleanedTitle = cleanLLMTitle(title);
      if (!cleanedTitle) {
        throw new Error("标题生成结果为空");
      }
      return cleanedTitle;
    });
  }
}
