import {
  ArticleRunDetail,
  ArticleRunRecord,
  ArticleRunStepRecord,
  nowIso,
  RunStateStore,
  StartRunInput,
} from "@src/core/ports/run-state-store.ts";

export class MemoryRunStateStore implements RunStateStore {
  private readonly runs = new Map<string, ArticleRunRecord>();
  private readonly steps = new Map<string, ArticleRunStepRecord[]>();

  async startRun(input: StartRunInput): Promise<ArticleRunRecord> {
    const existing = this.runs.get(input.runId);
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
    this.runs.set(input.runId, record);
    this.steps.set(input.runId, this.steps.get(input.runId) ?? []);
    return record;
  }

  async updateRun(
    runId: string,
    patch: Partial<ArticleRunRecord>,
  ): Promise<void> {
    const run = this.requireRun(runId);
    this.runs.set(runId, {
      ...run,
      ...patch,
      artifacts: patch.artifacts ?? run.artifacts,
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
    this.requireRun(runId);
    const steps = this.steps.get(runId) ?? [];
    const attempt = steps.filter((step) => step.name === name).length + 1;
    const record: ArticleRunStepRecord = {
      runId,
      name,
      status: "running",
      attempt,
      startedAt: nowIso(),
      inputArtifacts: options.inputArtifacts ?? [],
    };
    steps.push(record);
    this.steps.set(runId, steps);
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
    const step = this.requireLatestStep(runId, name);
    const finishedAt = nowIso();
    step.status = "succeeded";
    step.finishedAt = finishedAt;
    step.outputArtifacts = options.outputArtifacts ?? [];
    step.durationMs = step.startedAt
      ? Date.parse(finishedAt) - Date.parse(step.startedAt)
      : undefined;
    const run = this.requireRun(runId);
    await this.updateRun(runId, {
      artifacts: [...run.artifacts, ...(step.outputArtifacts ?? [])],
    });
  }

  async failStep(runId: string, name: string, error: string): Promise<void> {
    const step = this.requireLatestStep(runId, name);
    const finishedAt = nowIso();
    step.status = "failed";
    step.finishedAt = finishedAt;
    step.error = error;
    step.durationMs = step.startedAt
      ? Date.parse(finishedAt) - Date.parse(step.startedAt)
      : undefined;
    await this.updateRun(runId, { status: "running" });
  }

  async listRuns(limit = 20): Promise<ArticleRunRecord[]> {
    return [...this.runs.values()]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit);
  }

  async getRun(runId: string): Promise<ArticleRunDetail | null> {
    const run = this.runs.get(runId);
    if (!run) return null;
    return {
      ...run,
      steps: this.steps.get(runId) ?? [],
    };
  }

  private requireRun(runId: string): ArticleRunRecord {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`run 不存在: ${runId}`);
    }
    return run;
  }

  private requireLatestStep(
    runId: string,
    name: string,
  ): ArticleRunStepRecord {
    const step = [...(this.steps.get(runId) ?? [])]
      .reverse()
      .find((item) => item.name === name);
    if (!step) {
      throw new Error(`step 不存在: ${runId}/${name}`);
    }
    return step;
  }
}
