import { assertEquals } from "@std/assert";
import { LocalWorkflowRuntime } from "./local-workflow-runtime.ts";

Deno.test("LocalWorkflowRuntime executes workflow definition", async () => {
  const runtime = new LocalWorkflowRuntime();
  const result = await runtime.run({
    id: "test-workflow",
    async run(event, step) {
      return await step.do("double", async () => event.payload.value * 2);
    },
  }, {
    payload: { value: 21 },
    id: "test-event",
    timestamp: Date.now(),
  });

  assertEquals(result, 42);
});

Deno.test("LocalWorkflowRuntime respects zero retry limit", async () => {
  const runtime = new LocalWorkflowRuntime();
  let calls = 0;

  await runtime.run({
    id: "test-workflow",
    async run(_event, step) {
      try {
        await step.do(
          "no-retry",
          { retries: { limit: 0, delay: "0", backoff: "linear" } },
          async () => {
            calls += 1;
            throw new Error("boom");
          },
        );
      } catch {
        return calls;
      }
      return calls;
    },
  }, {
    payload: {},
    id: "test-event",
    timestamp: Date.now(),
  });

  assertEquals(calls, 1);
});
