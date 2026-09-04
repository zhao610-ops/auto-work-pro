export type ArtifactStoreType = "memory" | "local" | "kv" | "r2";

export interface ArtifactRef {
  store: ArtifactStoreType;
  key: string;
  contentType: string;
  label?: string;
  size?: number;
  checksum?: string;
}

export interface ArtifactObject {
  ref: ArtifactRef;
  body: Uint8Array;
}

export interface PutArtifactOptions {
  label?: string;
  contentType?: string;
}

export interface ArtifactStore {
  putJson<T>(
    key: string,
    value: T,
    options?: PutArtifactOptions,
  ): Promise<ArtifactRef>;
  getJson<T>(ref: ArtifactRef): Promise<T>;
  putText(
    key: string,
    value: string,
    options?: PutArtifactOptions,
  ): Promise<ArtifactRef>;
  getText(ref: ArtifactRef): Promise<string>;
  putBytes(
    key: string,
    value: Uint8Array,
    options?: PutArtifactOptions,
  ): Promise<ArtifactRef>;
  getObject(key: string): Promise<ArtifactObject | null>;
  createRunKey(runId: string, name: string, extension: string): string;
}

export function assertSafeArtifactKey(key: string): void {
  if (!key || key.startsWith("/") || key.includes("..") || key.includes("\\")) {
    throw new Error(`非法 artifact key: ${key}`);
  }
}

export function encodeJsonArtifact(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2));
}

export function decodeJsonArtifact<T>(value: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(value)) as T;
}

export function encodeTextArtifact(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function decodeTextArtifact(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

export function createArtifactRef(
  store: ArtifactStoreType,
  key: string,
  contentType: string,
  label?: string,
  size?: number,
): ArtifactRef {
  return {
    store,
    key,
    contentType,
    label,
    size,
  };
}
