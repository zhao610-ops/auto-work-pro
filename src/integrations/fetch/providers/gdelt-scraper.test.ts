import { assertEquals } from "jsr:@std/assert";
import { normalizeGdeltQuery } from "./gdelt-scraper.ts";

Deno.test("normalizeGdeltQuery 清理 GDELT 不接受的各类连接号", () => {
  assertEquals(
    normalizeGdeltQuery("AI-driven F-16 与 supply–chain"),
    "AI driven F 16 与 supply chain",
  );
});

Deno.test("normalizeGdeltQuery 保留查询操作符并整理空白", () => {
  assertEquals(
    normalizeGdeltQuery("  Nvidia   OR   TSMC  "),
    "Nvidia OR TSMC",
  );
});
