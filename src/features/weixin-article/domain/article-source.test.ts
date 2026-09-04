import { assertEquals, assertThrows } from "@std/assert";
import { parseArticleSources, parseSourceInput } from "./article-source.ts";

Deno.test("parseSourceInput uses default group for plain URL", () => {
  assertEquals(parseSourceInput("https://news.ycombinator.com/"), {
    raw: "https://news.ycombinator.com/",
    group: "default",
    url: "https://news.ycombinator.com/",
    kind: "url",
  });
});

Deno.test("parseSourceInput parses custom fetch group prefix", () => {
  assertEquals(parseSourceInput("web:https://example.com/ai-news"), {
    raw: "web:https://example.com/ai-news",
    group: "web",
    url: "https://example.com/ai-news",
    kind: "url",
  });
});

Deno.test("parseSourceInput parses search query source", () => {
  assertEquals(parseSourceInput("search:AI agent research news"), {
    raw: "search:AI agent research news",
    group: "search",
    url: "AI agent research news",
    kind: "query",
  });
  assertEquals(parseSourceInput("research:query:AI model evaluation"), {
    raw: "research:query:AI model evaluation",
    group: "research",
    url: "AI model evaluation",
    kind: "query",
  });
});

Deno.test("parseArticleSources dedupes by group and normalized URL", () => {
  assertEquals(
    parseArticleSources([
      "https://example.com",
      "https://example.com/",
      "web:https://example.com/",
    ]),
    [
      {
        raw: "https://example.com",
        group: "default",
        url: "https://example.com/",
        kind: "url",
      },
      {
        raw: "web:https://example.com/",
        group: "web",
        url: "https://example.com/",
        kind: "url",
      },
    ],
  );
});

Deno.test("parseArticleSources dedupes query sources by normalized text", () => {
  assertEquals(
    parseArticleSources([
      "search:AI   agent news",
      "search:AI agent news",
    ]),
    [{
      raw: "search:AI   agent news",
      group: "search",
      url: "AI agent news",
      kind: "query",
    }],
  );
});

Deno.test("parseSourceInput rejects invalid URL", () => {
  assertThrows(
    () => parseSourceInput("web:not-a-url"),
    Error,
    "数据源 URL 无效",
  );
});
