import { assertEquals, assertRejects } from "@std/assert";
import { ProviderError } from "@src/core/errors/provider-error.ts";
import { WeixinApiClient } from "@src/integrations/publish/providers/weixin-api-client.ts";

Deno.test("WeixinApiClient classifies IP whitelist error as auth", async () => {
  const client = new WeixinApiClient({
    fetchImpl: (() =>
      Promise.resolve(
        Response.json({ errcode: 40164, errmsg: "invalid ip 1.2.3.4" }),
      )) as typeof fetch,
  });

  const error = await assertRejects(
    () => client.postJson("/cgi-bin/draft/add", "token", {}),
    ProviderError,
  );
  assertEquals(error.provider, "weixin");
  assertEquals(error.kind, "auth");
});

Deno.test("WeixinApiClient redacts access token from error messages", async () => {
  const client = new WeixinApiClient({
    fetchImpl: (() =>
      Promise.resolve(
        new Response("not json", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      )) as typeof fetch,
  });

  const error = await assertRejects(
    () => client.postJson("/cgi-bin/draft/add", "secret-token", {}),
    ProviderError,
  );
  assertEquals(error.message.includes("secret-token"), false);
});

Deno.test("WeixinApiClient parses access token response", async () => {
  const client = new WeixinApiClient({
    fetchImpl: ((input: string | URL | Request) => {
      const url = String(input);
      assertEquals(url.includes("appid=appid"), true);
      return Promise.resolve(
        Response.json({ access_token: "token", expires_in: 7200 }),
      );
    }) as typeof fetch,
  });

  const token = await client.getAccessToken("appid", "secret");
  assertEquals(token.access_token, "token");
  assertEquals(token.expires_in, 7200);
});

Deno.test("WeixinApiClient preserves large Weixin message IDs", async () => {
  const client = new WeixinApiClient({
    fetchImpl: (() =>
      Promise.resolve(
        new Response(
          '{"errcode":0,"msg_id":3418223814652012345,"msg_data_id":2247483650}',
          { headers: { "content-type": "application/json" } },
        ),
      )) as typeof fetch,
  });

  const result = await client.postJson<{
    msg_id: string;
    msg_data_id: number;
  }>("/cgi-bin/message/mass/sendall", "token", {});

  assertEquals(result.msg_id, "3418223814652012345");
  assertEquals(result.msg_data_id, 2247483650);
});
