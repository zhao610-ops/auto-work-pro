import { assertEquals, assertRejects } from "@std/assert";
import { PexelsPhotoSearch } from "./pexels-photo-search.ts";

Deno.test("Pexels client sends official API parameters and normalizes photos", async () => {
  const requests: Array<{ url: URL; authorization: string | null }> = [];
  const client = new PexelsPhotoSearch({
    apiKey: "pexels-key",
    fetcher: (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      requests.push({
        url,
        authorization: headers.get("Authorization"),
      });
      return Promise.resolve(Response.json({
        photos: [{
          id: 123,
          width: 2400,
          height: 1600,
          url: "https://www.pexels.com/photo/123",
          photographer: "测试摄影师",
          photographer_url: "https://www.pexels.com/@tester",
          src: {
            landscape: "https://images.pexels.com/photos/123/landscape.jpeg",
          },
        }],
      }));
    },
  });

  const photos = await client.search({ query: " 全球 经济   新闻 " });

  assertEquals(requests.length, 1);
  assertEquals(requests[0].authorization, "pexels-key");
  assertEquals(requests[0].url.pathname, "/v1/search");
  assertEquals(requests[0].url.searchParams.get("query"), "全球 经济 新闻");
  assertEquals(requests[0].url.searchParams.get("orientation"), "landscape");
  assertEquals(requests[0].url.searchParams.get("locale"), "zh-CN");
  assertEquals(photos[0].photographer, "测试摄影师");
  assertEquals(
    photos[0].imageUrl,
    "https://images.pexels.com/photos/123/landscape.jpeg",
  );

  await client.search({ query: "全球 经济 新闻" });
  assertEquals(requests.length, 1);
});

Deno.test("Pexels client requires an API key", async () => {
  const client = new PexelsPhotoSearch({ apiKey: "" });

  await assertRejects(
    () => client.search({ query: "经济" }),
    Error,
    "PEXELS_API_KEY",
  );
});
