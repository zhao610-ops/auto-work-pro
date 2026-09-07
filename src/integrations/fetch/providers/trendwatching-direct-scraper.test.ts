import { assertEquals } from "@std/assert";
import {
  isTrendWatchingUrl,
  parseTrendWatchingHtml,
} from "./trendwatching-direct-scraper.ts";

Deno.test("TrendWatching direct parser extracts article cards", () => {
  const result = parseTrendWatchingHtml(
    `
    <html><body><main>
      <article>
        <h2>GLANCE TO CART</h2>
        <a href="/trends/glance-to-cart">Read</a>
        <p>Product discovery and checkout are moving closer together.</p>
        <p>This development changes how retailers design customer journeys and commerce content.</p>
      </article>
    </main></body></html>
  `,
    "https://www.trendwatching.com/trends-and-insights",
  );

  assertEquals(result.length, 1);
  assertEquals(result[0].title, "GLANCE TO CART");
  assertEquals(
    result[0].url,
    "https://www.trendwatching.com/trends/glance-to-cart",
  );
  assertEquals(result[0].metadata.provider, "trendwatching-direct");
});

Deno.test("TrendWatching direct parser falls back to main page text", () => {
  const result = parseTrendWatchingHtml(
    `
    <html><head><title>TrendWatching Daily</title></head><body><main>
      <h1>Daily trends and insights</h1>
      <p>${"consumer innovation and retail change ".repeat(12)}</p>
    </main></body></html>
  `,
    "https://www.trendwatching.com/trends-and-insights",
  );

  assertEquals(result.length, 1);
  assertEquals(result[0].title, "Daily trends and insights");
  assertEquals(isTrendWatchingUrl(result[0].url), true);
});
