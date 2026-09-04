import {
  EmbeddingOptions,
  EmbeddingProvider,
  EmbeddingResult,
} from "@src/core/ports/embedding.ts";
import { ResolvedTrendPublishConfig } from "@src/utils/config/define-config.ts";
import OpenAI from "npm:openai@4.87.3";

type EmbeddingConfig =
  ResolvedTrendPublishConfig["providers"]["vector"]["embedding"];

export class OpenAICompatibleEmbedding implements EmbeddingProvider {
  private baseURL!: string;
  private apiKey!: string;
  private defaultModel!: string;
  private availableModels: string[] = [];
  private client!: OpenAI;

  constructor(
    private embeddingConfig?: EmbeddingConfig,
    private specifiedModel?: string,
  ) {}

  async initialize(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const config = this.embeddingConfig;
    if (!config) {
      throw new Error("providers.vector.embedding is not configured");
    }
    this.baseURL = config.baseUrl;
    this.apiKey = config.apiKey;
    this.availableModels = (config.model || "text-embedding-v3").split("|")
      .map((model) => model.trim());
    this.defaultModel = this.specifiedModel || this.availableModels[0];
    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
    });
  }

  setBaseURL(url: string): void {
    this.baseURL = url;
  }

  setModel(model: string): void {
    if (this.availableModels.includes(model)) {
      this.defaultModel = model;
      return;
    }
    console.warn(
      `警告: 模型 ${model} 不在可用模型列表中，将使用默认模型 ${this.defaultModel}`,
    );
  }

  getModel(): string {
    return this.defaultModel;
  }

  getAvailableModels(): string[] {
    return [...this.availableModels];
  }

  async createEmbedding(
    text: string,
    options?: EmbeddingOptions,
  ): Promise<EmbeddingResult> {
    const model = options?.model || this.defaultModel;
    const dimensions = options?.dimensions || 1024;
    const encoding_format = options?.encoding_format || "float";

    try {
      const response = await this.client.embeddings.create({
        model,
        input: text,
        dimensions,
        encoding_format,
      });

      if (!response.data?.[0]?.embedding) {
        throw new Error("Invalid response from API");
      }

      return {
        embedding: response.data[0].embedding,
        model: response.model,
        dimensions,
      };
    } catch (error) {
      throw new Error(
        `Failed to create embedding: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
