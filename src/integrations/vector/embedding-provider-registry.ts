import {
  ProviderAdapter,
  ProviderCreateContext,
  ProviderRegistry,
} from "@src/registry/provider-registry.ts";
import {
  EmbeddingProvider,
  EmbeddingProviderType,
} from "@src/core/ports/embedding.ts";
import { OpenAICompatibleEmbedding } from "@src/integrations/vector/providers/openai-compatible-embedding.ts";
import { JinaEmbeddingProvider } from "@src/integrations/vector/providers/jina/jina-embedding-provider.ts";
import { ResolvedTrendPublishConfig } from "@src/utils/config/define-config.ts";

export interface EmbeddingProviderCreateOptions {
  model?: string;
}

export interface EmbeddingProviderAdapter
  extends ProviderAdapter<ResolvedTrendPublishConfig, EmbeddingProviderType> {
  kind: "vector";
  create(
    context?: ProviderCreateContext<
      ResolvedTrendPublishConfig,
      EmbeddingProviderCreateOptions
    >,
  ): EmbeddingProvider;
}

export const embeddingProviderRegistry = new ProviderRegistry<
  ResolvedTrendPublishConfig,
  EmbeddingProviderAdapter
>();

for (
  const id of [
    EmbeddingProviderType.OPENAI,
    EmbeddingProviderType.DASHSCOPE,
    EmbeddingProviderType.CUSTOM,
  ]
) {
  embeddingProviderRegistry.register({
    id,
    kind: "vector",
    isConfigured(config) {
      const embedding = config.providers.vector.embedding;
      return Boolean(
        embedding.baseUrl && embedding.apiKey && embedding.model,
      );
    },
    create(context) {
      return new OpenAICompatibleEmbedding(
        context?.config?.providers.vector.embedding,
        context?.options?.model,
      );
    },
  });
}

embeddingProviderRegistry.register({
  id: EmbeddingProviderType.JINA,
  kind: "vector",
  isConfigured(config) {
    return Boolean(config.providers.fetch.jina.apiKey);
  },
  create(context) {
    return new JinaEmbeddingProvider({
      apiKey: context?.config?.providers.fetch.jina.apiKey,
      model: context?.options?.model,
    });
  },
});
