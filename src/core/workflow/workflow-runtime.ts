export interface WorkflowEvent<TInput = unknown> {
  payload: TInput;
  id: string;
  timestamp: number;
}

export interface WorkflowStepOptions {
  retries?: {
    limit: number;
    delay: string | number;
    backoff: "linear" | "exponential";
  };
  timeout?: string | number;
}

export interface WorkflowStepContext {
  do<T>(
    name: string,
    optionsOrFn: WorkflowStepOptions | (() => Promise<T>),
    fn?: () => Promise<T>,
  ): Promise<T>;
  sleep(reason: string, duration: string | number): Promise<void>;
}

export interface WorkflowDefinition<TInput = unknown, TOutput = void> {
  id: string;
  run(
    event: WorkflowEvent<TInput>,
    step: WorkflowStepContext,
  ): Promise<TOutput>;
}

export interface WorkflowRuntime {
  run<TInput, TOutput>(
    workflow: WorkflowDefinition<TInput, TOutput>,
    event: WorkflowEvent<TInput>,
  ): Promise<TOutput>;
}
