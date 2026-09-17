import { assertEquals } from "@std/assert";
import { findMatchingDraft } from "./reconciliation.ts";

Deno.test("草稿列表使用头条 gid 作为真实文章 ID", () => {
  const result = findMatchingDraft({
    code: 0,
    draft_list: [{
      gid: "7685578687185486379",
      title: "阶段三验证稿",
    }],
  }, "阶段三验证稿");

  assertEquals(result, {
    articleId: "7685578687185486379",
    currentUrl: "https://mp.toutiao.com/profile_v4/manage/draft",
    status: "draft",
  });
});
