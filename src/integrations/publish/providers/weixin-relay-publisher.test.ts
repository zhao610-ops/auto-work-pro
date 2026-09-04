import { assertEquals } from "@std/assert";
import { WeixinRelayPublisher } from "@src/integrations/publish/providers/weixin-relay-publisher.ts";

Deno.test("WeixinRelayPublisher forwards selected account credentials", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const publisher = new WeixinRelayPublisher(
    {
      url: "https://relay.example.com",
      token: "relay-token",
    },
    {
      appId: "",
      appSecret: "",
      author: "默认作者",
      needOpenComment: true,
      onlyFansCanComment: false,
      accounts: {
        lab: {
          appId: "wx-lab",
          appSecret: "secret-lab",
          author: "实验室",
          needOpenComment: false,
          onlyFansCanComment: true,
        },
      },
    },
    "lab",
    {
      request: async (_url: string, options: RequestInit) => {
        capturedBody = JSON.parse(String(options.body));
        return {
          success: true,
          data: {
            publishId: "draft-id",
            status: "draft",
            publishedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
            platform: "weixin",
            accountId: "lab",
          },
        };
      },
      healthCheck: async () => true,
    },
  );

  const result = await publisher.publishArticle({
    title: "标题",
    digest: "摘要",
    content: "<section>正文</section>",
    coverMediaId: "cover-id",
  });

  assertEquals(capturedBody?.account, {
    accountId: "lab",
    appId: "wx-lab",
    appSecret: "secret-lab",
    author: "实验室",
    needOpenComment: false,
    onlyFansCanComment: true,
  });
  assertEquals(capturedBody?.payload, {
    title: "标题",
    digest: "摘要",
    content: "<section>正文</section>",
    coverMediaId: "cover-id",
  });
  assertEquals(result.accountId, "lab");
  assertEquals(result.publishedAt instanceof Date, true);
});
