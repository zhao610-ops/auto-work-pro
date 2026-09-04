import {
  ArticleRunDetail,
  ArticleRunRecord,
  ArticleRunStepRecord,
  nowIso,
  RunStateStore,
  StartRunInput,
} from "@src/core/ports/run-state-store.ts";
import type {
  CloudflareD1Database,
  CloudflareKvNamespace,
} from "@src/platform/cloudflare/cloudflare-bindings.ts";
import { ARTICLE_WORKFLOW_SCHEMA_SQL } from "@src/core/storage/article-workflow-schema.ts";

export class KvD1RunStateStore implements RunStateStore {
  private schemaReady = false;

  constructor(
    private readonly kv: CloudflareKvNamespace,
    private readonly d1: CloudflareD1Database,
  ) {}

  async startRun(input: StartRunInput): Promise<ArticleRunRecord> {
    await this.ensureSchema();
    const existing = await this.getRun(input.runId);
    const timestamp = nowIso();
    const record: ArticleRunRecord = {
      runId: input.runId,
      runKind: input.runKind ?? "single",
      parentRunId: input.parentRunId,
      accountId: input.accountId,
      profileId: input.profileId,
      mode: input.mode,
      status: "running",
      dryRun: input.dryRun,
      trigger: input.trigger,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      artifacts: existing?.artifacts ?? [],
    };
    await this.saveRun(record);
    return record;
  }

  async updateRun(
    runId: string,
    patch: Partial<ArticleRunRecord>,
  ): Promise<void> {
    const detail = await this.getRun(runId);
    if (!detail) {
      throw new Error(`run 不存在: ${runId}`);
    }
    await this.saveRun({
      ...detail,
      ...patch,
      artifacts: patch.artifacts ?? detail.artifacts,
      updatedAt: nowIso(),
    });
  }

  async finishRun(
    runId: string,
    patch: Partial<ArticleRunRecord> = {},
  ): Promise<void> {
    await this.updateRun(runId, {
      ...patch,
      status: "succeeded",
      finishedAt: nowIso(),
    });
  }

  async failRun(runId: string, error: string): Promise<void> {
    await this.updateRun(runId, {
      status: "failed",
      error,
      finishedAt: nowIso(),
    });
  }

  async startStep(
    runId: string,
    name: string,
    options: {
      inputArtifacts?: ArticleRunStepRecord["inputArtifacts"];
    } = {},
  ): Promise<ArticleRunStepRecord> {
    await this.ensureSchema();
    const attemptRow = await this.d1.prepare(
      "SELECT COUNT(*) AS count FROM article_run_steps WHERE run_id = ? AND name = ?",
    ).bind(runId, name).first<{ count: number }>();
    const record: ArticleRunStepRecord = {
      runId,
      name,
      status: "running",
      attempt: Number(attemptRow?.count ?? 0) + 1,
      startedAt: nowIso(),
      inputArtifacts: options.inputArtifacts ?? [],
    };
    await this.upsertStep(record);
    await this.updateRun(runId, { status: "running" });
    return record;
  }

  async finishStep(
    runId: string,
    name: string,
    options: {
      outputArtifacts?: ArticleRunStepRecord["outputArtifacts"];
    } = {},
  ): Promise<void> {
    const step = await this.requireLatestStep(runId, name);
    const finishedAt = nowIso();
    const nextStep: ArticleRunStepRecord = {
      ...step,
      status: "succeeded",
      finishedAt,
      durationMs: step.startedAt
        ? Date.parse(finishedAt) - Date.parse(step.startedAt)
        : undefined,
      outputArtifacts: options.outputArtifacts ?? [],
    };
    await this.upsertStep(nextStep);
    const run = await this.getRun(runId);
    if (run) {
      await this.updateRun(runId, {
        artifacts: [...run.artifacts, ...(nextStep.outputArtifacts ?? [])],
      });
    }
  }

  async failStep(runId: string, name: string, error: string): Promise<void> {
    const step = await this.requireLatestStep(runId, name);
    const finishedAt = nowIso();
    await this.upsertStep({
      ...step,
      status: "failed",
      finishedAt,
      durationMs: step.startedAt
        ? Date.parse(finishedAt) - Date.parse(step.startedAt)
        : undefined,
      error,
    });
  }

  async listRuns(limit = 20): Promise<ArticleRunRecord[]> {
    await this.ensureSchema();
    const result = await this.d1.prepare(
      "SELECT * FROM article_runs ORDER BY created_at DESC LIMIT ?",
    ).bind(limit).all<RunRow>();
    return result.results.map(rowToRun);
  }

  async getRun(runId: string): Promise<ArticleRunDetail | null> {
    await this.ensureSchema();
    const row = await this.d1.prepare(
      "SELECT * FROM article_runs WHERE run_id = ?",
    ).bind(runId).first<RunRow>();
    if (!row) return null;
    const stepRows = await this.d1.prepare(
      "SELECT * FROM article_run_steps WHERE run_id = ? ORDER BY started_at ASC, attempt ASC",
    ).bind(runId).all<StepRow>();
    return {
      ...rowToRun(row),
      steps: stepRows.results.map(rowToStep),
    };
  }

  private async saveRun(record: ArticleRunRecord): Promise<void> {
    await this.ensureSchema();
    await this.d1.prepare(
      `INSERT OR REPLACE INTO article_runs
      (run_id, run_kind, parent_run_id, account_id, profile_id, mode, status, dry_run, trigger_type, created_at, updated_at, finished_at, summary, error, artifacts_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      record.runId,
      record.runKind ?? "single",
      record.parentRunId ?? null,
      record.accountId ?? null,
      record.profileId ?? null,
      record.mode,
      record.status,
      record.dryRun ? 1 : 0,
      record.trigger,
      record.createdAt,
      record.updatedAt,
      record.finishedAt ?? null,
      record.summary ?? null,
      record.error ?? null,
      JSON.stringify(record.artifacts ?? []),
    ).run();
    try {
      await this.kv.put(`run:${record.runId}`, JSON.stringify(record));
      await this.kv.put("runs:latest", JSON.stringify(record));
    } catch (error) {
      console.warn("[cloudflare-run-state] KV cache write skipped", {
        runId: record.runId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async upsertStep(record: ArticleRunStepRecord): Promise<void> {
    await this.ensureSchema();
    await this.d1.prepare(
      `INSERT OR REPLACE INTO article_run_steps
      (run_id, name, attempt, status, started_at, finished_at, duration_ms, input_artifacts_json, output_artifacts_json, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      record.runId,
      record.name,
      record.attempt,
      record.status,
      record.startedAt ?? null,
      record.finishedAt ?? null,
      record.durationMs ?? null,
      JSON.stringify(record.inputArtifacts ?? []),
      JSON.stringify(record.outputArtifacts ?? []),
      record.error ?? null,
    ).run();
  }

  private async requireLatestStep(
    runId: string,
    name: string,
  ): Promise<ArticleRunStepRecord> {
    const row = await this.d1.prepare(
      "SELECT * FROM article_run_steps WHERE run_id = ? AND name = ? ORDER BY attempt DESC LIMIT 1",
    ).bind(runId, name).first<StepRow>();
    if (!row) {
      throw new Error(`step 不存在: ${runId}/${name}`);
    }
    return rowToStep(row);
  }

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    await this.ensureRunColumns();
    await this.ensureEditorialAccountColumns();
    for (const statement of splitSqlStatements(ARTICLE_WORKFLOW_SCHEMA_SQL)) {
      await this.d1.prepare(statement).run();
    }
    await this.ensureRunColumns();
    await this.ensureEditorialAccountColumns();
    this.schemaReady = true;
  }

  private async ensureRunColumns(): Promise<void> {
    for (
      const statement of [
        "ALTER TABLE article_runs ADD COLUMN run_kind TEXT NOT NULL DEFAULT 'single'",
        "ALTER TABLE article_runs ADD COLUMN parent_run_id TEXT",
        "ALTER TABLE article_runs ADD COLUMN account_id TEXT",
        "ALTER TABLE article_runs ADD COLUMN profile_id TEXT",
        "CREATE INDEX IF NOT EXISTS idx_article_runs_parent ON article_runs(parent_run_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_article_runs_account ON article_runs(account_id, created_at DESC)",
      ]
    ) {
      try {
        await this.d1.prepare(statement).run();
      } catch (error) {
        if (!isIgnorableSchemaError(error)) {
          throw error;
        }
      }
    }
  }

  private async ensureEditorialAccountColumns(): Promise<void> {
    for (
      const statement of [
        "ALTER TABLE editorial_article_memory ADD COLUMN account_id TEXT",
        "ALTER TABLE editorial_run_feedback ADD COLUMN account_id TEXT",
        "CREATE INDEX IF NOT EXISTS idx_editorial_article_memory_account_created ON editorial_article_memory(account_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_editorial_run_feedback_account_updated ON editorial_run_feedback(account_id, updated_at DESC)",
      ]
    ) {
      try {
        await this.d1.prepare(statement).run();
      } catch (error) {
        if (!isIgnorableSchemaError(error)) {
          throw error;
        }
      }
    }
  }
}

function isIgnorableSchemaError(error: unknown): boolean {
  const message = String(error);
  return message.includes("duplicate column name") ||
    message.includes("no such table");
}

interface RunRow {
  run_id: string;
  run_kind?: ArticleRunRecord["runKind"] | null;
  parent_run_id?: string | null;
  account_id?: string | null;
  profile_id?: string | null;
  mode: ArticleRunRecord["mode"];
  status: ArticleRunRecord["status"];
  dry_run: number;
  trigger_type: ArticleRunRecord["trigger"];
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  summary: string | null;
  error: string | null;
  artifacts_json: string | null;
}

interface StepRow {
  run_id: string;
  name: string;
  status: ArticleRunStepRecord["status"];
  attempt: number;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  input_artifacts_json: string | null;
  output_artifacts_json: string | null;
  error: string | null;
}

function rowToRun(row: RunRow): ArticleRunRecord {
  return {
    runId: row.run_id,
    runKind: row.run_kind ?? "single",
    parentRunId: row.parent_run_id ?? undefined,
    accountId: row.account_id ?? undefined,
    profileId: row.profile_id ?? undefined,
    mode: row.mode,
    status: row.status,
    dryRun: Boolean(row.dry_run),
    trigger: row.trigger_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at ?? undefined,
    summary: row.summary ?? undefined,
    error: row.error ?? undefined,
    artifacts: parseJson(row.artifacts_json, []),
  };
}

function rowToStep(row: StepRow): ArticleRunStepRecord {
  return {
    runId: row.run_id,
    name: row.name,
    status: row.status,
    attempt: row.attempt,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    inputArtifacts: parseJson(row.input_artifacts_json, []),
    outputArtifacts: parseJson(row.output_artifacts_json, []),
    error: row.error ?? undefined,
  };
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}
