import { assertEquals } from "@std/assert";
import { ToutiaoRelayClient } from "./toutiao-relay-client.ts";

Deno.test("头条 Relay 客户端提交系统到点后的直接发布请求", async () => {
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
          status: "published",
          title: "测试标题",
        },
      });
    },
  );

  const result = await client.publishNow({
    title: "测试标题",
    contentHtml: "<p>正文</p>",
    idempotencyKey: "job-1",
  });
  assertEquals(requestedUrl, "http://relay.local/api/toutiao/publish");
  assertEquals(result.articleId, "gid-1");
});
