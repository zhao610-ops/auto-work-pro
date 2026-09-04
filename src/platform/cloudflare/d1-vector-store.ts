import type {
  NewVectorRecord,
  SimilaritySearchResult,
  VectorRecord,
  VectorStore,
} from "@src/core/ports/vector-store.ts";
import { VectorSimilarityUtil } from "@src/utils/VectorSimilarityUtil.ts";
import type { CloudflareD1Database } from "@src/platform/cloudflare/cloudflare-bindings.ts";
import { ARTICLE_WORKFLOW_SCHEMA_SQL } from "@src/core/storage/article-workflow-schema.ts";

export class D1VectorStore implements VectorStore {
  private schemaReady = false;

  constructor(private readonly db: CloudflareD1Database) {}

  async create(data: NewVectorRecord): Promise<VectorRecord> {
    return await this.createWithId(Date.now(), data);
  }

  async createBatch(items: NewVectorRecord[]): Promise<VectorRecord[]> {
    const records: VectorRecord[] = [];
    const timestamp = Date.now();
    for (let index = 0; index < items.length; index++) {
      records.push(await this.createWithId(timestamp + index, items[index]));
    }
    return records;
  }

  private async createWithId(
    id: number,
    data: NewVectorRecord,
  ): Promise<VectorRecord> {
    await this.ensureSchema();
    await this.db.prepare(
      "INSERT INTO article_vectors (id, content, vector_json, vector_dim, vector_type) VALUES (?, ?, ?, ?, ?)",
    ).bind(
      id,
      data.content,
      JSON.stringify(data.vector),
      data.vectorDim,
      data.vectorType,
    ).run();
    const result = await this.getById(id);
    if (!result) {
      throw new Error("D1 向量写入后无法读取");
    }
    return result;
  }

  async getById(id: number): Promise<VectorRecord | null> {
    await this.ensureSchema();
    const row = await this.db.prepare(
      "SELECT * FROM article_vectors WHERE id = ?",
    ).bind(id).first<VectorRow>();
    return row ? rowToVector(row) : null;
  }

  async getByType(vectorType: string): Promise<VectorRecord[]> {
    await this.ensureSchema();
    const result = await this.db.prepare(
      "SELECT * FROM article_vectors WHERE vector_type = ?",
    ).bind(vectorType).all<VectorRow>();
    return result.results.map(rowToVector);
  }

  async update(
    id: number,
    data: Partial<NewVectorRecord>,
  ): Promise<boolean> {
    const existing = await this.getById(id);
    if (!existing) return false;
    const next = {
      content: data.content ?? existing.content ?? "",
      vector: data.vector ?? existing.vector,
      vectorDim: data.vectorDim ?? existing.vectorDim ?? existing.vector.length,
      vectorType: data.vectorType ?? existing.vectorType ?? "article",
    };
    await this.db.prepare(
      "UPDATE article_vectors SET content = ?, vector_json = ?, vector_dim = ?, vector_type = ? WHERE id = ?",
    ).bind(
      next.content,
      JSON.stringify(next.vector),
      next.vectorDim,
      next.vectorType,
      id,
    ).run();
    return true;
  }

  async delete(id: number): Promise<boolean> {
    const existing = await this.getById(id);
    if (!existing) return false;
    await this.db.prepare("DELETE FROM article_vectors WHERE id = ?").bind(id)
      .run();
    return true;
  }

  async deleteBatch(ids: number[]): Promise<boolean> {
    let deleted = false;
    for (const id of ids) {
      deleted = await this.delete(id) || deleted;
    }
    return deleted;
  }

  async findSimilar(
    vector: number[],
    options: {
      threshold?: number;
      limit?: number;
      vectorType?: string;
      similarityMethod?: "cosine" | "euclidean";
    } = {},
  ): Promise<SimilaritySearchResult[]> {
    const {
      threshold = 0.8,
      limit = 10,
      vectorType = "article",
      similarityMethod = "cosine",
    } = options;
    const records = await this.getByType(vectorType);
    return records
      .map((record) => ({
        ...record,
        similarity: similarityMethod === "cosine"
          ? VectorSimilarityUtil.cosineSimilarity(vector, record.vector)
          : VectorSimilarityUtil.distanceToSimilarity(
            VectorSimilarityUtil.euclideanDistance(vector, record.vector),
          ),
      }))
      .filter((record) => record.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  async getStats(_vectorType?: string): Promise<{
    total: number;
    byType: Record<string, number>;
  }> {
    await this.ensureSchema();
    const result = await this.db.prepare(
      "SELECT vector_type, COUNT(*) AS count FROM article_vectors GROUP BY vector_type",
    ).all<{ vector_type: string | null; count: number }>();
    const byType: Record<string, number> = {};
    let total = 0;
    for (const row of result.results) {
      const type = row.vector_type ?? "unknown";
      const count = Number(row.count);
      byType[type] = count;
      total += count;
    }
    return { total, byType };
  }

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    for (const statement of splitSqlStatements(ARTICLE_WORKFLOW_SCHEMA_SQL)) {
      await this.db.prepare(statement).run();
    }
    this.schemaReady = true;
  }
}

interface VectorRow {
  id: number;
  content: string | null;
  vector_json: string;
  vector_dim: number | null;
  vector_type: string | null;
}

function rowToVector(row: VectorRow): VectorRecord {
  return {
    id: Number(row.id),
    content: row.content,
    vector: parseVector(row.vector_json),
    vectorDim: row.vector_dim,
    vectorType: row.vector_type,
  };
}

function parseVector(value: string): number[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(Number) : [];
  } catch {
    return [];
  }
}

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}
