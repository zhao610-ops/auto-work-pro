import { assertEquals, assertRejects } from "@std/assert";
import { JinaSearchScraper } from "@src/integrations/fetch/providers/jina/jina-search-scraper.ts";

Deno.test("JinaSearchScraper converts search results into scraped contents", async () => {
  const scraper = new JinaSearchScraper("jina-key", {
    request(input: string, init: RequestInit) {
      assertEquals(input, "https://s.jina.ai/?q=AI%20agent%20news");
      assertEquals(init.method, "GET");
      assertEquals(
        (init.headers as Record<string, string>)["Authorization"],
        "Bearer jina-key",
      );
      return Promise.resolve({
        data: [{
          title: "Agent 新闻",
          url: "https://example.com/agent",
          content: "一段搜索结果摘要",
          publishedDate: "2026-05-24",
          image: "https://example.com/image.png",
        }],
      });
    },
  });

  const result = await scraper.scrape("AI agent news");

  assertEquals(result.length, 1);
  assertEquals(result[0].title, "Agent 新闻");
  assertEquals(result[0].url, "https://example.com/agent");
  assertEquals(result[0].metadata.provider, "jina-search");
  assertEquals(result[0].media?.[0].url, "https://example.com/image.png");
});

Deno.test("JinaSearchScraper rejects missing API key", async () => {
  const scraper = new JinaSearchScraper("", {
    request() {
      throw new Error("request should not be called");
    },
  });

  await assertRejects(
    () => scraper.scrape("AI agent news"),
    Error,
    "providers.fetch.jina.apiKey",
  );
});

Deno.test("JinaSearchScraper skips invalid result URLs", async () => {
  const scraper = new JinaSearchScraper("jina-key", {
    request() {
      return Promise.resolve({
        data: [
          { title: "bad", url: "javascript:alert(1)" },
          { title: "ok", url: "https://example.com/ok" },
        ],
      });
    },
  });

  const result = await scraper.scrape("AI news");

  assertEquals(result.length, 1);
  assertEquals(result[0].url, "https://example.com/ok");
});
