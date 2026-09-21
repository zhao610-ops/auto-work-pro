import type { PublishResult } from "@src/core/ports/content-publisher.ts";
import { LocalArtifactStore } from "@src/platform/local/local-artifact-store.ts";

export type ScheduledMassSendStatus =
  | "preparing"
  | "prepared"
  | "sending"
  | "sent"
  | "failed"
  | "blocked";

export interface ScheduledMassSendRecord {
  scheduleId: string;
  scheduleSlot: string;
  profileId: string;
  accountId?: string;
  sourceRunId: string;
  draftMediaId?: string;
  title?: string;
  scheduledFor: string;
  idempotencyKey: string;
  status: ScheduledMassSendStatus;
  /** 草稿生成的恢复次数，与真正调用群发接口的 attempts 分开统计。 */
  preparationAttempts?: number;
  attempts?: number;
  /** 质量不达标或生成失败后的下一次自动补生成时间。 */
  nextPreparationAt?: string;
  updatedAt: string;
  result?: PublishResult;
  error?: string;
}

export class LocalScheduledMassSendStore {
  private readonly artifacts: LocalArtifactStore;

  constructor(baseDir: string) {
    this.artifacts = new LocalArtifactStore(baseDir);
  }

  async get(scheduleId: string): Promise<ScheduledMassSendRecord | null> {
    const object = await this.artifacts.getObject(this.key(scheduleId));
    if (!object) return null;
    return JSON.parse(new TextDecoder().decode(object.body));
  }

  async save(
    record: Omit<ScheduledMassSendRecord, "updatedAt"> & { updatedAt?: string },
  ): Promise<ScheduledMassSendRecord> {
    const value: ScheduledMassSendRecord = {
      ...record,
      updatedAt: record.updatedAt ?? new Date().toISOString(),
    };
    await this.artifacts.putJson(this.key(record.scheduleId), value, {
      label: "定时群发队列",
      contentType: "application/json",
    });
    return value;
  }

  private key(scheduleId: string): string {
    const safeId = scheduleId.replace(/[^a-zA-Z0-9_-]/g, "-");
    return `scheduled-mass-send/${safeId}.json`;
  }
}
