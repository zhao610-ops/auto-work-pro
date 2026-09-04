import { Database } from "@db/sqlite";
import { dirname } from "node:path";
import { ARTICLE_WORKFLOW_SCHEMA_SQL } from "@src/core/storage/article-workflow-schema.ts";
import type {
  NewVectorRecord,
  SimilaritySearchResult,
  VectorRecord,
  VectorStore,
} from "@src/core/ports/vector-store.ts";
import { VectorSimilarityUtil } from "@src/utils/VectorSimilarityUtil.ts";

export class SQLiteVectorStore implements VectorStore {
  private db?: Database;

  constructor(private readonly databasePath: string) {}

  async create(data: NewVectorRecord): Promise<VectorRecord> {
    return this.createWithId(Date.now(), data);
  }

  async createBatch(items: NewVectorRecord[]): Promise<VectorRecord[]> {
    const records: VectorRecord[] = [];
    const timestamp = Date.now();
    for (let index = 0; index < items.length; index++) {
      records.push(this.createWithId(timestamp + index, items[index]));
    }
    return records;
  }

  async getById(id: number): Promise<VectorRecord | null> {
    const db = this.getDb();
    const row = db.prepare("SELECT * FROM article_vectors WHERE id = ?")
      .get(id) as VectorRow | undefined;
    return row ? rowToVector(row) : null;
  }

  async getByType(vectorType: string): Promise<VectorRecord[]> {
    const db = this.getDb();
    const rows = db.prepare(
      "SELECT * FROM article_vectors WHERE vector_type = ?",
    ).all(vectorType) as VectorRow[];
    return rows.map(rowToVector);
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
    this.getDb().prepare(
      "UPDATE article_vectors SET content = ?, vector_json = ?, vector_dim = ?, vector_type = ? WHERE id = ?",
    ).run(
      next.content,
      JSON.stringify(next.vector),
      next.vectorDim,
      next.vectorType,
      id,
    );
    return true;
  }

  async delete(id: number): Promise<boolean> {
    const existing = await this.getById(id);
    if (!existing) return false;
    this.getDb().prepare("DELETE FROM article_vectors WHERE id = ?").run(id);
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
    const rows = this.getDb().prepare(
      "SELECT vector_type, COUNT(*) AS count FROM article_vectors GROUP BY vector_type",
    ).all() as { vector_type: string | null; count: number }[];
    const byType: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      const type = row.vector_type ?? "unknown";
      const count = Number(row.count);
      byType[type] = count;
      total += count;
    }
    return { total, byType };
  }

  private createWithId(id: number, data: NewVectorRecord): VectorRecord {
    this.getDb().prepare(
      "INSERT INTO article_vectors (id, content, vector_json, vector_dim, vector_type) VALUES (?, ?, ?, ?, ?)",
    ).run(
      id,
      data.content,
      JSON.stringify(data.vector),
      data.vectorDim,
      data.vectorType,
    );
    const row = this.getDb().prepare(
      "SELECT * FROM article_vectors WHERE id = ?",
    ).get(id) as VectorRow | undefined;
    if (!row) {
      throw new Error("SQLite 向量写入后无法读取");
    }
    return rowToVector(row);
  }

  private getDb(): Database {
    if (!this.db) {
      if (this.databasePath !== ":memory:") {
        Deno.mkdirSync(dirname(this.databasePath), { recursive: true });
      }
      this.db = new Database(this.databasePath);
      this.db.exec(ARTICLE_WORKFLOW_SCHEMA_SQL);
    }
    return this.db;
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
