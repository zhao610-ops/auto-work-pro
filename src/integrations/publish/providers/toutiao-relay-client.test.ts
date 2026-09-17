import { assertEquals } from "@std/assert";
import { ToutiaoRelayClient } from "./toutiao-relay-client.ts";

Deno.test("头条 Relay 客户端提交原生定时请求", async () => {
  let requestedUrl = "";
  const client = new ToutiaoRelayClient(
    { url: "http://relay.local/", token: "token" },
    async (input) => {
      requestedUrl = String(input);
      return Response.json({
        success: true,
        data: {
          draftId: "draft-1",
          articleId: "gid-1",
          status: "scheduled",
          title: "测试标题",
          scheduledFor: "2026-09-16T03:00:00.000Z",
        },
      });
    },
  );

  const result = await client.schedule({
    title: "测试标题",
    contentHtml: "<p>正文</p>",
    idempotencyKey: "job-1",
    scheduledAt: "2026-09-16T03:00:00.000Z",
  });
  assertEquals(requestedUrl, "http://relay.local/api/toutiao/scheduled");
  assertEquals(result.articleId, "gid-1");
});
