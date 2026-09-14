import { assertEquals, assertRejects } from "@std/assert";
import { ProviderError } from "@src/core/errors/provider-error.ts";
import { WeixinApiClient } from "@src/integrations/publish/providers/weixin-api-client.ts";
import { WeixinPublisher } from "@src/integrations/publish/providers/weixin-publisher.ts";

const account = {
  appId: "wx-test",
  appSecret: "secret-test",
  author: "测试账号",
  needOpenComment: false,
  onlyFansCanComment: false,
  accounts: {},
};

const article = {
  title: "测试文章",
  digest: "测试摘要",
  content: "<section>测试正文</section>",
  coverMediaId: "cover-id",
};

Deno.test("WeixinPublisher draft mode only creates draft", async () => {
  const paths: string[] = [];
  const publisher = createPublisher((url) => {
    paths.push(url.pathname);
    if (url.pathname === "/cgi-bin/token") {
      return { access_token: "token", expires_in: 7200 };
    }
    if (url.pathname === "/cgi-bin/draft/add") {
      return { media_id: "draft-id" };
    }
    throw new Error(`不应调用 ${url.pathname}`);
  });

  const result = await publisher.publishArticle({
    ...article,
    publishMode: "draft",
  });

  assertEquals(result.status, "draft");
  assertEquals(result.publishId, "draft-id");
  assertEquals(result.draftMediaId, "draft-id");
  assertEquals(result.url, undefined);
  assertEquals(paths.includes("/cgi-bin/freepublish/submit"), false);
});

Deno.test("WeixinPublisher publish mode submits and waits for public article", async () => {
  let statusCalls = 0;
  const publisher = createPublisher((url) => {
    if (url.pathname === "/cgi-bin/token") {
      return { access_token: "token", expires_in: 7200 };
    }
    if (url.pathname === "/cgi-bin/draft/add") {
      return { media_id: "draft-id" };
    }
    if (url.pathname === "/cgi-bin/freepublish/submit") {
      return { publish_id: 12345 };
    }
    if (url.pathname === "/cgi-bin/freepublish/get") {
      statusCalls += 1;
      return statusCalls === 1 ? { publish_status: 1 } : {
        publish_status: 0,
        article_id: "article-id",
        article_detail: {
          item: [{ article_url: "https://mp.weixin.qq.com/s/public-id" }],
        },
      };
    }
    throw new Error(`未知接口 ${url.pathname}`);
  });

  const result = await publisher.publishArticle({
    ...article,
    publishMode: "publish",
  });

  assertEquals(result.status, "published");
  assertEquals(result.publishId, "12345");
  assertEquals(result.draftMediaId, "draft-id");
  assertEquals(result.articleId, "article-id");
  assertEquals(result.url, "https://mp.weixin.qq.com/s/public-id");
  assertEquals(statusCalls, 2);
});

Deno.test("WeixinPublisher mass mode sends draft to all followers", async () => {
  const requests: Array<{ path: string; body?: Record<string, unknown> }> = [];
  let statusCalls = 0;
  const client = new WeixinApiClient({
    fetchImpl: (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = new URL(String(input));
      const body = init?.body && typeof init.body === "string"
        ? JSON.parse(init.body)
        : undefined;
      requests.push({ path: url.pathname, body });
      if (url.pathname === "/cgi-bin/token") {
        return Response.json({ access_token: "token", expires_in: 7200 });
      }
      if (url.pathname === "/cgi-bin/draft/add") {
        return Response.json({ media_id: "draft-id" });
      }
      if (url.pathname === "/cgi-bin/message/mass/sendall") {
        return Response.json({ msg_id: 67890, msg_data_id: 123 });
      }
      if (url.pathname === "/cgi-bin/message/mass/get") {
        statusCalls += 1;
        return Response.json({
          msg_id: 67890,
          msg_status: statusCalls === 1 ? "SENDING" : "SEND_SUCCESS",
        });
      }
      throw new Error(`未知接口 ${url.pathname}`);
    }) as typeof fetch,
  });
  const publisher = new WeixinPublisher(account, undefined, client, undefined, {
    publishStatusPollIntervalMs: 0,
    publishStatusTimeoutMs: 1000,
    sleep: () => Promise.resolve(),
  });

  const result = await publisher.publishArticle({
    ...article,
    publishMode: "mass",
    idempotencyKey: "run-123",
  });

  assertEquals(result.status, "mass-sent");
  assertEquals(result.publishId, "67890");
  assertEquals(result.massMessageId, "67890");
  assertEquals(result.massDataId, "123");
  assertEquals(result.draftMediaId, "draft-id");
  assertEquals(statusCalls, 2);
  assertEquals(
    requests.find((item) => item.path === "/cgi-bin/message/mass/sendall")
      ?.body,
    {
      filter: { is_to_all: true },
      mpnews: { media_id: "draft-id" },
      msgtype: "mpnews",
      send_ignore_reprint: 0,
      clientmsgid: "run-123",
    },
  );
});

Deno.test("WeixinPublisher mass mode requires idempotency key", async () => {
  const publisher = createPublisher((url) => {
    if (url.pathname === "/cgi-bin/token") {
      return { access_token: "token", expires_in: 7200 };
    }
    if (url.pathname === "/cgi-bin/draft/add") {
      return { media_id: "draft-id" };
    }
    throw new Error(`不应调用 ${url.pathname}`);
  });

  const error = await assertRejects(
    () => publisher.publishArticle({ ...article, publishMode: "mass" }),
    ProviderError,
  );
  assertEquals(error.message.includes("幂等键"), true);
});

Deno.test("WeixinPublisher sends an existing draft without creating another draft", async () => {
  const requests: string[] = [];
  const client = new WeixinApiClient({
    fetchImpl: (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      requests.push(url.pathname);
      if (url.pathname === "/cgi-bin/token") {
        return Response.json({ access_token: "token", expires_in: 7200 });
      }
      if (url.pathname === "/cgi-bin/message/mass/sendall") {
        return Response.json({ msg_id: 10001, msg_data_id: 20001 });
      }
      if (url.pathname === "/cgi-bin/message/mass/get") {
        return Response.json({ msg_id: 10001, msg_status: "SEND_SUCCESS" });
      }
      throw new Error(`未知接口 ${url.pathname}`);
    }) as typeof fetch,
  });
  const publisher = new WeixinPublisher(account, undefined, client);

  const result = await publisher.massSendDraft({
    draftMediaId: "prepared-draft-id",
    idempotencyKey: "scheduled-run-1",
  });

  assertEquals(result.status, "mass-sent");
  assertEquals(result.draftMediaId, "prepared-draft-id");
  assertEquals(requests.includes("/cgi-bin/draft/add"), false);
});

Deno.test("WeixinPublisher truncates mass clientmsgid to 32 ASCII bytes", async () => {
  const requests: Array<{ path: string; body: unknown }> = [];
  const publisher = createPublisher((url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ path: url.pathname, body });
    if (url.pathname === "/cgi-bin/token") {
      return { access_token: "token", expires_in: 7200 };
    }
    if (url.pathname === "/cgi-bin/draft/add") {
      return { media_id: "draft-id" };
    }
    if (url.pathname === "/cgi-bin/message/mass/sendall") {
      return { msg_id: 67890 };
    }
    if (url.pathname === "/cgi-bin/message/mass/get") {
      return { msg_id: 67890, msg_status: "SEND_SUCCESS" };
    }
    throw new Error(`未知接口 ${url.pathname}`);
  });

  await publisher.publishArticle({
    ...article,
    publishMode: "mass",
    idempotencyKey: "manual-run-33fb730f-eb75-4fe4-8afd-2ee03e3f129c",
  });

  const request = requests.find((item) =>
    item.path === "/cgi-bin/message/mass/sendall"
  );
  assertEquals(
    (request?.body as { clientmsgid?: string }).clientmsgid,
    "manual-run-33fb730f-eb75-4fe4-8a",
  );
});

Deno.test("WeixinPublisher keeps publishing status after polling timeout", async () => {
  const publisher = createPublisher((url) => {
    if (url.pathname === "/cgi-bin/token") {
      return { access_token: "token", expires_in: 7200 };
    }
    if (url.pathname === "/cgi-bin/draft/add") {
      return { media_id: "draft-id" };
    }
    if (url.pathname === "/cgi-bin/freepublish/submit") {
      return { publish_id: "publish-id" };
    }
    throw new Error(`超时配置下不应查询 ${url.pathname}`);
  }, { publishStatusTimeoutMs: 0 });

  const result = await publisher.publishArticle({
    ...article,
    publishMode: "publish",
  });

  assertEquals(result.status, "publishing");
  assertEquals(result.publishId, "publish-id");
  assertEquals(result.draftMediaId, "draft-id");
});

Deno.test("WeixinPublisher reports terminal publish rejection", async () => {
  const publisher = createPublisher((url) => {
    if (url.pathname === "/cgi-bin/token") {
      return { access_token: "token", expires_in: 7200 };
    }
    if (url.pathname === "/cgi-bin/draft/add") {
      return { media_id: "draft-id" };
    }
    if (url.pathname === "/cgi-bin/freepublish/submit") {
      return { publish_id: "publish-id" };
    }
    if (url.pathname === "/cgi-bin/freepublish/get") {
      return { publish_status: 4 };
    }
    throw new Error(`未知接口 ${url.pathname}`);
  });

  const error = await assertRejects(
    () =>
      publisher.publishArticle({
        ...article,
        publishMode: "publish",
      }),
    ProviderError,
  );
  assertEquals(error.message.includes("审核未通过"), true);
});

function createPublisher(
  responseFor: (url: URL, init?: RequestInit) => unknown,
  options: { publishStatusTimeoutMs?: number } = {},
): WeixinPublisher {
  const client = new WeixinApiClient({
    fetchImpl: ((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      return Promise.resolve(Response.json(responseFor(url, init)));
    }) as typeof fetch,
  });
  return new WeixinPublisher(account, undefined, client, undefined, {
    publishStatusPollIntervalMs: 0,
    publishStatusTimeoutMs: options.publishStatusTimeoutMs ?? 1000,
    sleep: () => Promise.resolve(),
  });
}
