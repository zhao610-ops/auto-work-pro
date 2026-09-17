import { assertEquals } from "@std/assert";
import { ToutiaoArticleRecordStore } from "./article-record-store.ts";

Deno.test("ToutiaoArticleRecordStore 持久化并按标题查找最新记录", async () => {
  const directory = await Deno.makeTempDir({ prefix: "toutiao-record-store-" });
  const path = `${directory}/records.json`;
  const store = new ToutiaoArticleRecordStore(path);
  const first = {
    idempotencyKey: "run-1",
    title: "同一标题",
    articleId: "draft-1",
    status: "draft" as const,
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
    reconciledAt: "2026-09-15T00:00:00.000Z",
  };
  const second = {
    ...first,
    idempotencyKey: "run-2",
    articleId: "draft-2",
    updatedAt: "2026-09-15T01:00:00.000Z",
  };

  await store.upsert(first);
  await store.upsert(second);

  const reloaded = new ToutiaoArticleRecordStore(path);
  assertEquals((await reloaded.get("run-1"))?.articleId, "draft-1");
  assertEquals((await reloaded.findByTitle("同一标题"))?.articleId, "draft-2");
  await Deno.remove(directory, { recursive: true });
});
