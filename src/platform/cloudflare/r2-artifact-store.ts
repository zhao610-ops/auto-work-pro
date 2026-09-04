import {
  ArtifactObject,
  ArtifactRef,
  ArtifactStore,
  assertSafeArtifactKey,
  createArtifactRef,
  decodeJsonArtifact,
  decodeTextArtifact,
  encodeJsonArtifact,
  encodeTextArtifact,
  PutArtifactOptions,
} from "@src/core/ports/artifact-store.ts";
import type { CloudflareR2Bucket } from "@src/platform/cloudflare/cloudflare-bindings.ts";

export class R2ArtifactStore implements ArtifactStore {
  constructor(private readonly bucket: CloudflareR2Bucket) {}

  async putJson<T>(
    key: string,
    value: T,
    options: PutArtifactOptions = {},
  ): Promise<ArtifactRef> {
    return await this.putBytes(key, encodeJsonArtifact(value), {
      contentType: "application/json",
      ...options,
    });
  }

  async getJson<T>(ref: ArtifactRef): Promise<T> {
    const object = await this.getObject(ref.key);
    if (!object) {
      throw new Error(`artifact 不存在: ${ref.key}`);
    }
    return decodeJsonArtifact<T>(object.body);
  }

  async putText(
    key: string,
    value: string,
    options: PutArtifactOptions = {},
  ): Promise<ArtifactRef> {
    return await this.putBytes(key, encodeTextArtifact(value), {
      contentType: "text/plain; charset=utf-8",
      ...options,
    });
  }

  async getText(ref: ArtifactRef): Promise<string> {
    const object = await this.getObject(ref.key);
    if (!object) {
      throw new Error(`artifact 不存在: ${ref.key}`);
    }
    return decodeTextArtifact(object.body);
  }

  async putBytes(
    key: string,
    value: Uint8Array,
    options: PutArtifactOptions = {},
  ): Promise<ArtifactRef> {
    assertSafeArtifactKey(key);
    const contentType = options.contentType ?? "application/octet-stream";
    const result = await this.bucket.put(key, value, {
      httpMetadata: { contentType },
      customMetadata: options.label ? { label: options.label } : undefined,
    });
    return createArtifactRef(
      "r2",
      key,
      contentType,
      options.label,
      result?.size ?? value.byteLength,
    );
  }

  async getObject(key: string): Promise<ArtifactObject | null> {
    assertSafeArtifactKey(key);
    const object = await this.bucket.get(key);
    if (!object) return null;
    const buffer = await object.arrayBuffer();
    return {
      ref: createArtifactRef(
        "r2",
        key,
        object.httpMetadata?.contentType ?? contentTypeFromKey(key),
        object.customMetadata?.label,
        object.size,
      ),
      body: new Uint8Array(buffer),
    };
  }

  createRunKey(runId: string, name: string, extension: string): string {
    return `runs/${runId}/${name}.${extension.replace(/^\./, "")}`;
  }
}

function contentTypeFromKey(key: string): string {
  if (key.endsWith(".json")) return "application/json";
  if (key.endsWith(".html")) return "text/html; charset=utf-8";
  if (key.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}
