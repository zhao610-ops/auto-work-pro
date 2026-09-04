export interface CloudflareKvNamespace {
  get<T = string>(
    key: string,
    options?: { type?: "text" | "json" },
  ): Promise<T | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number; metadata?: unknown },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface CloudflareR2ObjectBody {
  key: string;
  size: number;
  httpMetadata?: {
    contentType?: string;
  };
  customMetadata?: Record<string, string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export interface CloudflareR2Bucket {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null,
    options?: {
      httpMetadata?: {
        contentType?: string;
      };
      customMetadata?: Record<string, string>;
    },
  ): Promise<{ key: string; size?: number } | null>;
  get(key: string): Promise<CloudflareR2ObjectBody | null>;
  delete(key: string): Promise<void>;
}

export interface CloudflareD1PreparedStatement {
  bind(...values: unknown[]): CloudflareD1PreparedStatement;
  run<T = unknown>(): Promise<
    { success: boolean; meta: unknown; results?: T[] }
  >;
  all<T = unknown>(): Promise<
    { success: boolean; results: T[]; meta: unknown }
  >;
  first<T = unknown>(): Promise<T | null>;
}

export interface CloudflareD1Database {
  prepare(query: string): CloudflareD1PreparedStatement;
  exec(query: string): Promise<{ count: number; duration: number }>;
}
