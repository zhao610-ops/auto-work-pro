import {
  ProviderAdapter,
  ProviderCreateContext,
  ProviderRegistry,
} from "@src/registry/provider-registry.ts";
import { LLMProvider } from "@src/core/ports/llm.ts";
import { OpenAICompatibleLLM } from "@src/integrations/llm/providers/openai-compatible-llm.ts";
import { ResolvedTrendPublishConfig } from "@src/utils/config/define-config.ts";

export type LLMProviderName = "openai-compatible";

export interface LLMProviderAdapter
  extends ProviderAdapter<ResolvedTrendPublishConfig, LLMProviderName> {
  kind: "llm";
  create(
    context: ProviderCreateContext<ResolvedTrendPublishConfig>,
  ): LLMProvider;
}

export const llmProviderRegistry = new ProviderRegistry<
  ResolvedTrendPublishConfig,
  LLMProviderAdapter
>();

llmProviderRegistry.register({
  id: "openai-compatible",
  kind: "llm",
  isConfigured(config) {
    const ai = config.providers.ai;
    return Boolean(ai.baseUrl && ai.apiKey && ai.model);
  },
  create({ config }) {
    if (!config) {
      throw new Error("LLM provider requires resolved app config");
    }
    return new OpenAICompatibleLLM(config.providers.ai);
  },
});
