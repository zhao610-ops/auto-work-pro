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
import { dirname, join, normalize, relative } from "node:path";

export class LocalArtifactStore implements ArtifactStore {
  constructor(private readonly baseDir: string) {}

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
    const path = this.resolveKey(key);
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeFile(path, value);
    return createArtifactRef(
      "local",
      key,
      options.contentType ?? "application/octet-stream",
      options.label,
      value.byteLength,
    );
  }

  async getObject(key: string): Promise<ArtifactObject | null> {
    const path = this.resolveKey(key);
    try {
      const body = await Deno.readFile(path);
      return {
        ref: createArtifactRef(
          "local",
          key,
          contentTypeFromKey(key),
          undefined,
          body.byteLength,
        ),
        body,
      };
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return null;
      }
      throw error;
    }
  }

  createRunKey(runId: string, name: string, extension: string): string {
    return `runs/${runId}/${name}.${extension.replace(/^\./, "")}`;
  }

  public getAbsolutePath(key: string): string {
    return this.resolveKey(key);
  }

  private resolveKey(key: string): string {
    assertSafeArtifactKey(key);
    const base = normalize(this.baseDir);
    const fullPath = normalize(join(base, key));
    const rel = relative(base, fullPath);
    if (rel.startsWith("..") || rel === "") {
      throw new Error(`非法 artifact key: ${key}`);
    }
    return fullPath;
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
