import { assertEquals } from "@std/assert";
import { join } from "node:path";
import { SQLiteVectorStore } from "@src/integrations/vector/sqlite-vector-store.ts";

Deno.test("SQLiteVectorStore auto-creates schema and stores vectors", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = new SQLiteVectorStore(join(dir, "vectors.sqlite3"));
    const record = await store.create({
      content: "hello world",
      vector: [1, 0, 0],
      vectorDim: 3,
      vectorType: "article",
    });

    assertEquals(record.content, "hello world");
    assertEquals(await store.getByType("article"), [record]);

    const similar = await store.findSimilar([1, 0, 0], {
      threshold: 0.99,
      vectorType: "article",
    });
    assertEquals(similar.length, 1);
    assertEquals(similar[0].id, record.id);

    const stats = await store.getStats();
    assertEquals(stats.total, 1);
    assertEquals(stats.byType.article, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
