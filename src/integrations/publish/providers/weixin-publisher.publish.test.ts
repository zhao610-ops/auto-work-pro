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
  responseFor: (url: URL) => unknown,
  options: { publishStatusTimeoutMs?: number } = {},
): WeixinPublisher {
  const client = new WeixinApiClient({
    fetchImpl: ((input: string | URL | Request) => {
      const url = new URL(String(input));
      return Promise.resolve(Response.json(responseFor(url)));
    }) as typeof fetch,
  });
  return new WeixinPublisher(account, undefined, client, undefined, {
    publishStatusPollIntervalMs: 0,
    publishStatusTimeoutMs: options.publishStatusTimeoutMs ?? 1000,
    sleep: () => Promise.resolve(),
  });
}
