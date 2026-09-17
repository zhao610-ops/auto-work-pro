import { LocalArtifactStore } from "@src/platform/local/local-artifact-store.ts";

export type ToutiaoScheduleJobStatus =
  | "preparing"
  | "ready"
  | "scheduled"
  | "published"
  | "blocked"
  | "failed";

export interface ToutiaoScheduleJob {
  id: string;
  targetAt: string;
  sourceRunId?: string;
  title?: string;
  htmlArtifactKey?: string;
  coverImageUrl?: string;
  idempotencyKey: string;
  status: ToutiaoScheduleJobStatus;
  articleId?: string;
  screenshotPath?: string;
  error?: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

/** 头条队列与文章工作流隔离保存，避免浏览器发布状态影响微信公众号队列。 */
export class LocalToutiaoScheduleStore {
  private readonly artifacts: LocalArtifactStore;

  constructor(baseDir: string) {
    this.artifacts = new LocalArtifactStore(baseDir);
  }

  async get(id: string): Promise<ToutiaoScheduleJob | null> {
    const object = await this.artifacts.getObject(this.jobKey(id));
    return object ? JSON.parse(new TextDecoder().decode(object.body)) : null;
  }

  async list(): Promise<ToutiaoScheduleJob[]> {
    const object = await this.artifacts.getObject(this.indexKey());
    if (!object) return [];
    const ids = JSON.parse(new TextDecoder().decode(object.body)) as string[];
    const records = await Promise.all(ids.map((id) => this.get(id)));
    return records.filter((record): record is ToutiaoScheduleJob => Boolean(record))
      .sort((left, right) => right.targetAt.localeCompare(left.targetAt));
  }

  async save(
    job: Omit<ToutiaoScheduleJob, "createdAt" | "updatedAt"> &
      Partial<Pick<ToutiaoScheduleJob, "createdAt" | "updatedAt">>,
  ): Promise<ToutiaoScheduleJob> {
    const existing = await this.get(job.id);
    const value: ToutiaoScheduleJob = {
      ...existing,
      ...job,
      createdAt: job.createdAt ?? existing?.createdAt ?? new Date().toISOString(),
      updatedAt: job.updatedAt ?? new Date().toISOString(),
    };
    await this.artifacts.putJson(this.jobKey(value.id), value, {
      label: "头条定时发布任务",
      contentType: "application/json",
    });
    const ids = new Set((await this.readIndex()));
    ids.add(value.id);
    await this.artifacts.putJson(this.indexKey(), [...ids].slice(-60), {
      label: "头条定时发布任务索引",
      contentType: "application/json",
    });
    return value;
  }

  private async readIndex(): Promise<string[]> {
    const object = await this.artifacts.getObject(this.indexKey());
    if (!object) return [];
    const parsed = JSON.parse(new TextDecoder().decode(object.body));
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  }

  private jobKey(id: string): string {
    return `toutiao-scheduled/jobs/${safeId(id)}.json`;
  }

  private indexKey(): string {
    return "toutiao-scheduled/index.json";
  }
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}
