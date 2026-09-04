import {
  ArticleRunDetail,
  ArticleRunRecord,
  ArticleRunStepRecord,
  nowIso,
  RunStateStore,
  StartRunInput,
} from "@src/core/ports/run-state-store.ts";
import { dirname, join } from "node:path";

interface RunStateFile {
  runs: ArticleRunRecord[];
  steps: ArticleRunStepRecord[];
}

const EMPTY_STATE: RunStateFile = {
  runs: [],
  steps: [],
};

export class LocalJsonRunStateStore implements RunStateStore {
  private readonly filePath: string;

  constructor(baseDir: string) {
    this.filePath = join(baseDir, "runs", "state.json");
  }

  async startRun(input: StartRunInput): Promise<ArticleRunRecord> {
    const state = await this.readState();
    const timestamp = nowIso();
    const existing = state.runs.find((run) => run.runId === input.runId);
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
    state.runs = [
      record,
      ...state.runs.filter((run) => run.runId !== input.runId),
    ];
    await this.writeState(state);
    return record;
  }

  async updateRun(
    runId: string,
    patch: Partial<ArticleRunRecord>,
  ): Promise<void> {
    const state = await this.readState();
    const index = state.runs.findIndex((run) => run.runId === runId);
    if (index < 0) {
      throw new Error(`run 不存在: ${runId}`);
    }
    state.runs[index] = {
      ...state.runs[index],
      ...patch,
      artifacts: patch.artifacts ?? state.runs[index].artifacts,
      updatedAt: nowIso(),
    };
    await this.writeState(state);
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
    const state = await this.readState();
    if (!state.runs.some((run) => run.runId === runId)) {
      throw new Error(`run 不存在: ${runId}`);
    }
    const attempt =
      state.steps.filter((step) => step.runId === runId && step.name === name)
        .length + 1;
    const record: ArticleRunStepRecord = {
      runId,
      name,
      status: "running",
      attempt,
      startedAt: nowIso(),
      inputArtifacts: options.inputArtifacts ?? [],
    };
    state.steps.push(record);
    await this.writeState(state);
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
    const state = await this.readState();
    const step = this.findLatestStep(state, runId, name);
    const finishedAt = nowIso();
    step.status = "succeeded";
    step.finishedAt = finishedAt;
    step.outputArtifacts = options.outputArtifacts ?? [];
    step.durationMs = step.startedAt
      ? Date.parse(finishedAt) - Date.parse(step.startedAt)
      : undefined;
    const run = state.runs.find((item) => item.runId === runId);
    if (run) {
      run.artifacts = [...run.artifacts, ...(step.outputArtifacts ?? [])];
      run.updatedAt = finishedAt;
    }
    await this.writeState(state);
  }

  async failStep(runId: string, name: string, error: string): Promise<void> {
    const state = await this.readState();
    const step = this.findLatestStep(state, runId, name);
    const finishedAt = nowIso();
    step.status = "failed";
    step.finishedAt = finishedAt;
    step.error = error;
    step.durationMs = step.startedAt
      ? Date.parse(finishedAt) - Date.parse(step.startedAt)
      : undefined;
    await this.writeState(state);
  }

  async listRuns(limit = 20): Promise<ArticleRunRecord[]> {
    const state = await this.readState();
    return state.runs
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit);
  }

  async getRun(runId: string): Promise<ArticleRunDetail | null> {
    const state = await this.readState();
    const run = state.runs.find((item) => item.runId === runId);
    if (!run) return null;
    return {
      ...run,
      steps: state.steps.filter((step) => step.runId === runId),
    };
  }

  private async readState(): Promise<RunStateFile> {
    try {
      return JSON.parse(await Deno.readTextFile(this.filePath)) as RunStateFile;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return structuredClone(EMPTY_STATE);
      }
      throw error;
    }
  }

  private async writeState(state: RunStateFile): Promise<void> {
    await Deno.mkdir(dirname(this.filePath), { recursive: true });
    await Deno.writeTextFile(this.filePath, JSON.stringify(state, null, 2));
  }

  private findLatestStep(
    state: RunStateFile,
    runId: string,
    name: string,
  ): ArticleRunStepRecord {
    const step = [...state.steps]
      .reverse()
      .find((item) => item.runId === runId && item.name === name);
    if (!step) {
      throw new Error(`step 不存在: ${runId}/${name}`);
    }
    return step;
  }
}
