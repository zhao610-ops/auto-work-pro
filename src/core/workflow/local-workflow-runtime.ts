import {
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowRuntime,
} from "./workflow-runtime.ts";
import { MetricsCollector } from "@src/core/workflow/workflow-metrics.ts";
import { WorkflowStep } from "@src/core/workflow/workflow-step.ts";
import { withLoggerContext } from "@src/core/logger/logger-context.ts";

export class LocalWorkflowRuntime implements WorkflowRuntime {
  constructor(
    private readonly metricsCollector = new MetricsCollector(),
  ) {}

  async run<TInput, TOutput>(
    workflow: WorkflowDefinition<TInput, TOutput>,
    event: WorkflowEvent<TInput>,
  ): Promise<TOutput> {
    const payload = readPayloadContext(event.payload);
    return await withLoggerContext({
      runId: payload.runId ?? event.id,
      workflowId: workflow.id,
      profileId: payload.profileId,
      dryRun: payload.dryRun,
      trigger: payload.trigger,
      mode: "local",
    }, async () => {
      this.metricsCollector.startWorkflow(workflow.id, event.id);
      const step = new WorkflowStep(
        "local-step-execution",
        this.metricsCollector,
        workflow.id,
        event.id,
      );

      try {
        const result = await workflow.run(event, step);
        this.metricsCollector.endWorkflow(workflow.id, event.id);
        return result;
      } catch (error) {
        this.metricsCollector.endWorkflow(
          workflow.id,
          event.id,
          error as Error,
        );
        throw error;
      }
    });
  }
}

function readPayloadContext(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  const record = payload as Record<string, unknown>;
  return {
    runId: stringValue(record.runId),
    profileId: stringValue(record.profileId),
    trigger: stringValue(record.trigger),
    dryRun: typeof record.dryRun === "boolean" ? record.dryRun : undefined,
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
