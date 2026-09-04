// Get your Jina AI API key for free: https://jina.ai/?sui=apikey

import {
  EmbeddingOptions,
  EmbeddingProvider,
  EmbeddingResult,
} from "@src/core/ports/embedding.ts";
import { HttpClient } from "@src/utils/http/http-client.ts";
import { z } from "npm:zod@3.25.76";

// Zod Schema for Jina Embeddings API Request
const JinaEmbeddingRequestSchema = z.object({
  model: z.string(),
  input: z.array(z.string()),
  encoding_format: z.enum(["float", "base64"]).optional(),
  // Jina also supports 'dimensions' for some models, could be added to EmbeddingOptions
});

// Zod Schema for a single embedding object in the Jina API Response
const JinaEmbeddingObjectSchema = z.object({
  object: z.string().optional(), // e.g., "embedding"
  embedding: z.array(z.number()),
  index: z.number(),
});

// Zod Schema for Jina Embeddings API Response
const JinaEmbeddingResponseSchema = z.object({
  model: z.string(),
  data: z.array(JinaEmbeddingObjectSchema),
  usage: z.object({
    total_tokens: z.number(),
    prompt_tokens: z.number().optional(), // Some models might not return this
  }),
});

export interface JinaEmbeddingProviderConfig {
  apiKey?: string;
  model?: string; // Default: "jina-embeddings-v2-base-en"
  // other Jina specific configurations can be added here
}

export class JinaEmbeddingProvider implements EmbeddingProvider {
  private apiKey = "";
  private defaultModel: string;
  private jinaApiUrl = "https://api.jina.ai/v1/embeddings";

  constructor(
    private readonly config?: JinaEmbeddingProviderConfig,
    private readonly httpClient = HttpClient.getInstance(),
  ) {
    this.defaultModel = config?.model || "jina-embeddings-v2-base-en"; // A common default Jina model
  }

  async initialize(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.apiKey = this.config?.apiKey ?? "";
    if (!this.apiKey) {
      throw new Error(
        "providers.fetch.jina.apiKey is not set. " +
          "Get your Jina AI API key for free: https://jina.ai/?sui=apikey",
      );
    }
  }

  async createEmbedding(
    text: string,
    options?: EmbeddingOptions,
  ): Promise<EmbeddingResult> {
    const model = options?.model || this.defaultModel;
    const encoding_format = options?.encoding_format || "float";

    // Jina API expects 'input' to be an array of strings.
    // The interface provides a single 'text', so we wrap it in an array.
    const requestBody = JinaEmbeddingRequestSchema.parse({
      model: model,
      input: [text],
      encoding_format: encoding_format,
      // If options.dimensions is provided, and the chosen Jina model supports it,
      // it could be passed here. For example, some models accept a `dimensions` parameter.
      // However, the Jina API documentation for the /v1/embeddings endpoint
      // doesn't list `dimensions` as a top-level request parameter.
      // It's usually tied to the model choice itself or specific newer models.
    });

    console.info(
      `[JinaEmbeddingProvider] Creating embedding for text (first 50 chars): "${
        text.substring(0, 50)
      }..." with model: ${model}`,
    );

    try {
      const result = await this.httpClient.request<unknown>(this.jinaApiUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify(requestBody),
        retries: 1,
        timeout: 30000,
      });
      const parsedResult = JinaEmbeddingResponseSchema.safeParse(result);

      if (!parsedResult.success) {
        console.error(
          `[JinaEmbeddingProvider] Invalid API response structure: ${parsedResult.error.toString()}`,
          result,
        );
        throw new Error(
          `Jina Embeddings API returned an invalid response structure. ${parsedResult.error.toString()}`,
        );
      }

      const apiData = parsedResult.data;

      if (
        !apiData.data || apiData.data.length === 0 || !apiData.data[0].embedding
      ) {
        console.warn(
          "[JinaEmbeddingProvider] API returned no embedding data.",
          apiData,
        );
        throw new Error("Jina Embeddings API returned no embedding data.");
      }

      const embeddingData = apiData.data[0]; // Since we send one text, we expect one embedding object

      return {
        embedding: embeddingData.embedding,
        model: apiData.model, // The model actually used by Jina
        dimensions: embeddingData.embedding.length, // Derived from the embedding vector
      };
    } catch (error) {
      console.error(
        `[JinaEmbeddingProvider] Error creating embedding for text "${
          text.substring(0, 50)
        }...":`,
        error,
      );
      if (error instanceof Error) {
        throw new Error(
          `Failed to create embedding using Jina: ${error.message}`,
        );
      }
      throw new Error(`Failed to create embedding using Jina: Unknown error`);
    }
  }
}
