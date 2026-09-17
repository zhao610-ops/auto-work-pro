import { assertEquals } from "@std/assert";
import { LocalToutiaoScheduleStore } from "./local-toutiao-schedule-store.ts";

Deno.test("头条定时队列持久化并列出任务", async () => {
  const directory = await Deno.makeTempDir({ prefix: "toutiao-schedule-store-" });
  const store = new LocalToutiaoScheduleStore(directory);
  await store.save({
    id: "toutiao-202609160300",
    targetAt: "2026-09-16T03:00:00.000Z",
    title: "测试标题",
    idempotencyKey: "toutiao-202609160300",
    status: "ready",
    attempts: 0,
  });

  assertEquals((await store.get("toutiao-202609160300"))?.status, "ready");
  assertEquals((await store.list()).length, 1);
  await Deno.remove(directory, { recursive: true });
});
