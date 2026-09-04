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
import type { CloudflareKvNamespace } from "@src/platform/cloudflare/cloudflare-bindings.ts";

interface KvArtifactEnvelope {
  contentType: string;
  label?: string;
  size: number;
  bodyBase64: string;
}

export class KvArtifactStore implements ArtifactStore {
  constructor(private readonly kv: CloudflareKvNamespace) {}

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
    const envelope: KvArtifactEnvelope = {
      contentType,
      label: options.label,
      size: value.byteLength,
      bodyBase64: bytesToBase64(value),
    };
    await this.kv.put(kvKey(key), JSON.stringify(envelope));
    return createArtifactRef(
      "kv",
      key,
      contentType,
      options.label,
      value.byteLength,
    );
  }

  async getObject(key: string): Promise<ArtifactObject | null> {
    assertSafeArtifactKey(key);
    const envelope = await this.kv.get<KvArtifactEnvelope>(kvKey(key), {
      type: "json",
    });
    if (!envelope) return null;
    return {
      ref: createArtifactRef(
        "kv",
        key,
        envelope.contentType,
        envelope.label,
        envelope.size,
      ),
      body: base64ToBytes(envelope.bodyBase64),
    };
  }

  createRunKey(runId: string, name: string, extension: string): string {
    return `runs/${runId}/${name}.${extension.replace(/^\./, "")}`;
  }
}

function kvKey(key: string): string {
  return `artifact:${key}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
