import { dirname } from "jsr:@std/path@1";
import type { ToutiaoArticleRecord } from "./types.ts";

interface PersistedState {
  version: 1;
  records: ToutiaoArticleRecord[];
}

/**
 * 单账号 Relay 的小型本地状态仓库。
 * 写入采用“临时文件 + rename”，避免服务中断时留下半截 JSON。
 */
export class ToutiaoArticleRecordStore {
  private records = new Map<string, ToutiaoArticleRecord>();
  private loaded = false;
  private writeQueue = Promise.resolve();

  constructor(private readonly path: string) {}

  async get(idempotencyKey: string): Promise<ToutiaoArticleRecord | undefined> {
    await this.load();
    return this.records.get(idempotencyKey);
  }

  async findByTitle(title: string): Promise<ToutiaoArticleRecord | undefined> {
    await this.load();
    return [...this.records.values()]
      .filter((record) => record.title === title)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  }

  async upsert(record: ToutiaoArticleRecord): Promise<ToutiaoArticleRecord> {
    await this.load();
    this.records.set(record.idempotencyKey, record);
    this.writeQueue = this.writeQueue.then(() => this.persist());
    await this.writeQueue;
    return record;
  }

  /** 平台侧确认删除草稿后，移除本地幂等映射以允许重新创建文章。 */
  async remove(idempotencyKey: string): Promise<void> {
    await this.load();
    this.records.delete(idempotencyKey);
    this.writeQueue = this.writeQueue.then(() => this.persist());
    await this.writeQueue;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    const text = await Deno.readTextFile(this.path).catch((error) => {
      if (error instanceof Deno.errors.NotFound) return "";
      throw error;
    });
    if (text.trim()) {
      const parsed = JSON.parse(text) as Partial<PersistedState>;
      if (parsed.version !== 1 || !Array.isArray(parsed.records)) {
        throw new Error("头条本地状态文件格式不受支持");
      }
      for (const record of parsed.records) {
        if (isRecord(record)) this.records.set(record.idempotencyKey, record);
      }
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await Deno.mkdir(dirname(this.path), { recursive: true });
    const tempPath = `${this.path}.${crypto.randomUUID()}.tmp`;
    const state: PersistedState = {
      version: 1,
      records: [...this.records.values()].sort((left, right) =>
        left.idempotencyKey.localeCompare(right.idempotencyKey)
      ),
    };
    await Deno.writeTextFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, {
      create: true,
    });
    await Deno.rename(tempPath, this.path);
  }
}

function isRecord(value: unknown): value is ToutiaoArticleRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ToutiaoArticleRecord>;
  return typeof record.idempotencyKey === "string" &&
    typeof record.title === "string" &&
    (record.status === "draft" || record.status === "scheduled" ||
      record.status === "published" ||
      record.status === "pending_reconciliation") &&
    typeof record.createdAt === "string" && typeof record.updatedAt === "string" &&
    typeof record.reconciledAt === "string";
}
