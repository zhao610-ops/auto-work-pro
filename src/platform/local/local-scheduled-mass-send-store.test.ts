import { assertEquals } from "@std/assert";
import { LocalScheduledMassSendStore } from "./local-scheduled-mass-send-store.ts";

Deno.test("scheduled mass send store persists prepared draft", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const store = new LocalScheduledMassSendStore(directory);
    await store.save({
      scheduleId: "schedule-1",
      scheduleSlot: "schedule-1:2026-09-12T11:00:Asia/Shanghai",
      profileId: "profile-1",
      accountId: "default",
      sourceRunId: "run-1",
      draftMediaId: "draft-1",
      title: "测试文章",
      scheduledFor: "2026-09-12T03:00:00.000Z",
      idempotencyKey: "scheduled-run-1",
      status: "prepared",
    });

    const record = await store.get("schedule-1");
    assertEquals(record?.draftMediaId, "draft-1");
    assertEquals(record?.status, "prepared");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
