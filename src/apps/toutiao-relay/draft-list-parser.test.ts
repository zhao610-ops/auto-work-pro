import { assertEquals } from "@std/assert";
import {
  createContentFingerprint,
  findMatchingDraft,
} from "./reconciliation.ts";

Deno.test("草稿列表使用头条 gid 和真实编辑地址", async () => {
  const result = await findMatchingDraft({
    code: 0,
    draft_list: [{
      gid: "7685578687185486379",
      title: "阶段三验证稿",
      edit_url:
        "https://mp.toutiao.com/profile_v4/graphic/publish?draft_id=7685578687185486379",
    }],
  }, { title: "阶段三验证稿" });

  assertEquals(result, {
    articleId: "7685578687185486379",
    currentUrl:
      "https://mp.toutiao.com/profile_v4/graphic/publish?draft_id=7685578687185486379",
    editUrl:
      "https://mp.toutiao.com/profile_v4/graphic/publish?draft_id=7685578687185486379",
    status: "draft",
  });
});

Deno.test("同标题草稿按正文指纹和创建时间选择唯一文章", async () => {
  const contentFingerprint = await createContentFingerprint(
    "这是本次要发布的正文",
  );
  const result = await findMatchingDraft({
    draft_list: [
      {
        gid: "old-draft",
        title: "同标题",
        content: "历史草稿正文",
        create_time: "2026-09-18T11:00:00.000Z",
      },
      {
        gid: "target-draft",
        title: "同标题",
        content: "这是本次要发布的正文",
        create_time: "2026-09-22T10:50:00.000Z",
        edit_url:
          "https://mp.toutiao.com/profile_v4/graphic/publish?draft_id=target-draft",
      },
    ],
  }, {
    title: "同标题",
    contentFingerprint,
    createdAt: "2026-09-22T11:00:00.000Z",
  });

  assertEquals(result?.articleId, "target-draft");
  assertEquals(
    result?.editUrl,
    "https://mp.toutiao.com/profile_v4/graphic/publish?draft_id=target-draft",
  );
});

Deno.test("无法区分的同标题草稿不会冒险选取", async () => {
  const result = await findMatchingDraft({
    draft_list: [
      { gid: "draft-a", title: "同标题" },
      { gid: "draft-b", title: "同标题" },
    ],
  }, { title: "同标题" });
  assertEquals(result, undefined);
});
