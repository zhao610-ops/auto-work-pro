import { embeddingProviderRegistry } from "@src/integrations/vector/embedding-provider-registry.ts";
import {
  EmbeddingProvider,
  EmbeddingProviderType,
} from "@src/core/ports/embedding.ts";
import type { ResolvedTrendPublishConfig } from "@src/utils/config/define-config.ts";
import { OpenAICompatibleEmbedding } from "@src/integrations/vector/providers/openai-compatible-embedding.ts";
import { JinaEmbeddingProvider } from "@src/integrations/vector/providers/jina/jina-embedding-provider.ts";

export interface EmbeddingProviderTypeMap {
  [EmbeddingProviderType.OPENAI]: OpenAICompatibleEmbedding;
  [EmbeddingProviderType.DASHSCOPE]: OpenAICompatibleEmbedding;
  [EmbeddingProviderType.CUSTOM]: OpenAICompatibleEmbedding;
  [EmbeddingProviderType.JINA]: JinaEmbeddingProvider;
}

/**
 * 解析 Embedding Provider 配置
 * 支持两种格式:
 * 1. 简单格式: "PROVIDER" - 仅指定提供者类型
 * 2. 扩展格式: "PROVIDER:model" - 指定提供者类型和模型
 */
interface ParsedEmbeddingConfig {
  providerType: EmbeddingProviderType;
  model?: string;
}

/**
 * Embedding provider 解析器，负责按类型创建、缓存并刷新 provider。
 */
export class EmbeddingProviderResolver {
  private providers: Map<string, EmbeddingProvider> = new Map();

  constructor(private readonly config?: ResolvedTrendPublishConfig) {}

  /**
   * 解析 Provider 配置字符串
   * @param config 配置字符串，格式为 "PROVIDER" 或 "PROVIDER:model"
   */
  private parseConfig(config: string): ParsedEmbeddingConfig {
    const parts = config.split(":");
    const providerType = parts[0] as EmbeddingProviderType;
    const model = parts.length > 1 ? parts[1] : undefined;
    return { providerType, model };
  }

  /**
   * 获取提供者缓存键
   * @param config 解析后的配置对象
   */
  private getProviderCacheKey(config: ParsedEmbeddingConfig): string {
    return config.model
      ? `${config.providerType}:${config.model}`
      : config.providerType;
  }

  /**
   * 获取指定类型的 Embedding Provider
   * @param typeOrConfig Provider 类型或配置字符串
   * @param needRefresh 是否需要刷新配置
   */
  public async getProvider<T extends ParsedEmbeddingConfig>(
    typeOrConfig: T | string,
    needRefresh: boolean = true,
  ): Promise<EmbeddingProviderTypeMap[T["providerType"]]> {
    // 解析配置
    const config = typeof typeOrConfig === "string"
      ? this.parseConfig(typeOrConfig)
      : typeOrConfig;

    // 获取缓存键
    const cacheKey = this.getProviderCacheKey(config);

    // 如果已经创建过该类型的提供者，且不需要刷新，直接返回
    if (this.providers.has(cacheKey) && !needRefresh) {
      return this.providers.get(
        cacheKey,
      )! as EmbeddingProviderTypeMap[T["providerType"]];
    }

    // 如果需要刷新且提供者存在，先刷新配置
    if (needRefresh && this.providers.has(cacheKey)) {
      await this.providers.get(cacheKey)!.refresh();
      return this.providers.get(
        cacheKey,
      )! as EmbeddingProviderTypeMap[T["providerType"]];
    }

    // 创建新的 provider
    const provider = this.createProvider(config);

    // 初始化提供者
    try {
      await provider.initialize();
      this.providers.set(cacheKey, provider);
      return provider as EmbeddingProviderTypeMap[T["providerType"]];
    } catch (error) {
      console.error(`初始化 Embedding Provider 失败 [${cacheKey}]:`, error);
      throw new Error(
        `无法初始化 Embedding Provider [${cacheKey}]: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * 创建指定类型的 Provider
   * @param config Provider 配置
   */
  private createProvider(config: ParsedEmbeddingConfig): EmbeddingProvider {
    return embeddingProviderRegistry.get(config.providerType).create({
      config: this.config,
      options: {
        model: config.model,
      },
    });
  }
}
