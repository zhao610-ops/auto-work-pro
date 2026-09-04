import { llmProviderRegistry } from "@src/integrations/llm/llm-provider-registry.ts";
import { LLMProvider } from "@src/core/ports/llm.ts";
import type { ResolvedTrendPublishConfig } from "@src/utils/config/define-config.ts";

/**
 * 全项目只维护一套 OpenAI Chat Completions 兼容 LLM 配置。
 */
export class LlmProviderResolver {
  private provider?: LLMProvider;

  constructor(private readonly config: ResolvedTrendPublishConfig) {}

  public async getDefaultProvider(
    needRefresh: boolean = true,
  ): Promise<LLMProvider> {
    if (this.provider && !needRefresh) {
      return this.provider;
    }

    if (this.provider && needRefresh) {
      await this.provider.refresh();
      return this.provider;
    }

    this.provider = llmProviderRegistry.get("openai-compatible").create({
      config: this.config,
    });
    await this.provider.initialize();
    return this.provider;
  }

  public async getLLMProvider(): Promise<LLMProvider> {
    return await this.getDefaultProvider();
  }

  public async refreshAllProviders(): Promise<void> {
    if (this.provider) {
      await this.provider.refresh();
    }
  }
}
