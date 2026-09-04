import type { ArtifactRef } from "@src/core/ports/artifact-store.ts";

export type RuntimeMode = "local" | "cloudflare-workflow";
export type RunTrigger = "manual" | "cron";
export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";
export type RunStepStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

export interface ArticleRunRecord {
  runId: string;
  runKind?: "single" | "matrix-parent" | "matrix-child";
  parentRunId?: string;
  accountId?: string;
  profileId?: string;
  mode: RuntimeMode;
  status: RunStatus;
  dryRun: boolean;
  trigger: RunTrigger;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  summary?: string;
  error?: string;
  artifacts: ArtifactRef[];
}

export interface ArticleRunStepRecord {
  runId: string;
  name: string;
  status: RunStepStatus;
  attempt: number;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  inputArtifacts?: ArtifactRef[];
  outputArtifacts?: ArtifactRef[];
  error?: string;
}

export interface ArticleRunDetail extends ArticleRunRecord {
  steps: ArticleRunStepRecord[];
}

export interface StartRunInput {
  runId: string;
  runKind?: ArticleRunRecord["runKind"];
  parentRunId?: string;
  accountId?: string;
  profileId?: string;
  mode: RuntimeMode;
  dryRun: boolean;
  trigger: RunTrigger;
}

export interface RunStateStore {
  startRun(input: StartRunInput): Promise<ArticleRunRecord>;
  updateRun(
    runId: string,
    patch: Partial<
      Pick<ArticleRunRecord, "status" | "summary" | "error" | "artifacts">
    >,
  ): Promise<void>;
  finishRun(
    runId: string,
    patch?: Partial<Pick<ArticleRunRecord, "summary" | "artifacts">>,
  ): Promise<void>;
  failRun(runId: string, error: string): Promise<void>;
  startStep(
    runId: string,
    name: string,
    options?: {
      inputArtifacts?: ArtifactRef[];
    },
  ): Promise<ArticleRunStepRecord>;
  finishStep(
    runId: string,
    name: string,
    options?: {
      outputArtifacts?: ArtifactRef[];
    },
  ): Promise<void>;
  failStep(runId: string, name: string, error: string): Promise<void>;
  listRuns(limit?: number): Promise<ArticleRunRecord[]>;
  getRun(runId: string): Promise<ArticleRunDetail | null>;
}

export function nowIso(): string {
  return new Date().toISOString();
}
