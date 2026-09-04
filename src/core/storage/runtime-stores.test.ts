import { assertEquals, assertExists } from "@std/assert";
import { MemoryArtifactStore } from "@src/core/storage/memory-artifact-store.ts";
import { MemoryRunStateStore } from "@src/core/storage/memory-run-state-store.ts";
import { LocalArtifactStore } from "@src/platform/local/local-artifact-store.ts";
import { LocalJsonRunStateStore } from "@src/platform/local/local-json-run-state-store.ts";

Deno.test("memory artifact store reads and writes json/text", async () => {
  const store = new MemoryArtifactStore();
  const jsonRef = await store.putJson(
    store.createRunKey("run-1", "payload", "json"),
    { ok: true },
    { label: "Payload" },
  );
  const textRef = await store.putText(
    store.createRunKey("run-1", "article", "html"),
    "<section>ok</section>",
    { contentType: "text/html; charset=utf-8" },
  );

  assertEquals(await store.getJson(jsonRef), { ok: true });
  assertEquals(await store.getText(textRef), "<section>ok</section>");
});

Deno.test("memory run state store records runs and steps", async () => {
  const store = new MemoryRunStateStore();
  await store.startRun({
    runId: "run-1",
    mode: "local",
    dryRun: true,
    trigger: "manual",
  });
  await store.startStep("run-1", "render");
  await store.finishStep("run-1", "render");
  await store.finishRun("run-1", { summary: "done" });

  const run = await store.getRun("run-1");
  assertExists(run);
  assertEquals(run.status, "succeeded");
  assertEquals(run.steps[0].name, "render");
  assertEquals(run.steps[0].status, "succeeded");
});

Deno.test("local artifact and run state stores persist dashboard data", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const artifacts = new LocalArtifactStore(dir);
    const states = new LocalJsonRunStateStore(dir);
    const ref = await artifacts.putText(
      artifacts.createRunKey("run-2", "preview", "html"),
      "<html></html>",
      { contentType: "text/html; charset=utf-8" },
    );
    await states.startRun({
      runId: "run-2",
      mode: "local",
      dryRun: true,
      trigger: "manual",
    });
    await states.startStep("run-2", "publish", {
      inputArtifacts: [ref],
    });
    await states.finishStep("run-2", "publish", {
      outputArtifacts: [ref],
    });

    const reloaded = new LocalJsonRunStateStore(dir);
    const run = await reloaded.getRun("run-2");
    assertExists(run);
    assertEquals(run.artifacts[0].key, ref.key);
    assertEquals(
      (await artifacts.getObject(ref.key))?.ref.contentType,
      ref.contentType,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
