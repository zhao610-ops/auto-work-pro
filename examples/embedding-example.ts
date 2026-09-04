import { EmbeddingProviderResolver } from "@src/integrations/vector/embedding-provider-resolver.ts";
import { EmbeddingProviderType } from "@src/core/ports/embedding.ts";

async function main() {
  try {
    // 获取 DashScope embedding provider
    const embeddingResolver = EmbeddingProviderResolver.getInstance();
    const provider = await embeddingResolver.getProvider(
      EmbeddingProviderType.DASHSCOPE,
    );

    // 生成文本的 embedding
    const text =
      "The clothes are of good quality and look good, definitely worth the wait. I love them.";
    const result = await provider.createEmbedding(text, {
      dimensions: 1024,
      encoding_format: "float",
    });

    console.log("Embedding result:", {
      model: result.model,
      dimensions: result.dimensions,
      embedding: result.embedding.slice(0, 5), // 只显示前5个维度作为示例
    });

    // 使用 OpenAI embedding provider
    const openaiProvider = await embeddingResolver.getProvider(
      EmbeddingProviderType.OPENAI,
    );
    const openaiResult = await openaiProvider.createEmbedding(text, {
      dimensions: 1536, // OpenAI 的默认维度
      encoding_format: "float",
    });

    console.log("OpenAI Embedding result:", {
      model: openaiResult.model,
      dimensions: openaiResult.dimensions,
      embedding: openaiResult.embedding.slice(0, 5), // 只显示前5个维度作为示例
    });
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

main();
