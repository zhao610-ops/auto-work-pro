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

export class MemoryArtifactStore implements ArtifactStore {
  private readonly objects = new Map<string, ArtifactObject>();

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
    const ref = createArtifactRef(
      "memory",
      key,
      options.contentType ?? "application/octet-stream",
      options.label,
      value.byteLength,
    );
    this.objects.set(key, { ref, body: value });
    return ref;
  }

  async getObject(key: string): Promise<ArtifactObject | null> {
    assertSafeArtifactKey(key);
    return this.objects.get(key) ?? null;
  }

  createRunKey(runId: string, name: string, extension: string): string {
    return `runs/${runId}/${name}.${extension.replace(/^\./, "")}`;
  }
}
