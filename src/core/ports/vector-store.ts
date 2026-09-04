export interface VectorRecord {
  id: number;
  content: string | null;
  vector: number[];
  vectorDim: number | null;
  vectorType: string | null;
}

export interface NewVectorRecord {
  content: string;
  vector: number[];
  vectorDim: number;
  vectorType: string;
}

export interface SimilaritySearchResult extends VectorRecord {
  similarity: number;
}

export interface VectorStore {
  create(data: NewVectorRecord): Promise<VectorRecord>;
  createBatch(items: NewVectorRecord[]): Promise<VectorRecord[]>;
  getById(id: number): Promise<VectorRecord | null>;
  getByType(vectorType: string): Promise<VectorRecord[]>;
  update(id: number, data: Partial<NewVectorRecord>): Promise<boolean>;
  delete(id: number): Promise<boolean>;
  deleteBatch(ids: number[]): Promise<boolean>;
  findSimilar(
    vector: number[],
    options?: {
      threshold?: number;
      limit?: number;
      vectorType?: string;
      similarityMethod?: "cosine" | "euclidean";
    },
  ): Promise<SimilaritySearchResult[]>;
  getStats(vectorType?: string): Promise<{
    total: number;
    byType: Record<string, number>;
  }>;
}
