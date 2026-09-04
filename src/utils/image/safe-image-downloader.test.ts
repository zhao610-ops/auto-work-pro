import { assertEquals, assertRejects } from "@std/assert";
import { ProviderError } from "@src/core/errors/provider-error.ts";
import { SafeImageDownloader } from "@src/utils/image/safe-image-downloader.ts";

Deno.test("SafeImageDownloader rejects localhost before fetch", async () => {
  let called = false;
  const downloader = new SafeImageDownloader({
    fetchImpl: (() => {
      called = true;
      return Promise.resolve(new Response());
    }) as typeof fetch,
  });

  const error = await assertRejects(
    () => downloader.download("http://localhost/image.png"),
    ProviderError,
  );
  assertEquals(error.kind, "validation");
  assertEquals(called, false);
});

Deno.test("SafeImageDownloader rejects resolved private address", async () => {
  const downloader = new SafeImageDownloader({
    resolveHostname: async () => ["10.0.0.1"],
  });

  const error = await assertRejects(
    () => downloader.download("https://example.com/image.png"),
    ProviderError,
  );
  assertEquals(error.kind, "validation");
});

Deno.test("SafeImageDownloader rejects non image content type", async () => {
  const downloader = new SafeImageDownloader({
    resolveHostname: async () => ["93.184.216.34"],
    fetchImpl: (() =>
      Promise.resolve(
        new Response("nope", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      )) as typeof fetch,
  });

  const error = await assertRejects(
    () => downloader.download("https://example.com/image.png"),
    ProviderError,
  );
  assertEquals(error.kind, "validation");
});

Deno.test("SafeImageDownloader enforces max bytes while reading", async () => {
  const downloader = new SafeImageDownloader({
    maxBytes: 3,
    resolveHostname: async () => ["93.184.216.34"],
    fetchImpl: (() =>
      Promise.resolve(
        new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      )) as typeof fetch,
  });

  const error = await assertRejects(
    () => downloader.download("https://example.com/image.png"),
    ProviderError,
  );
  assertEquals(error.kind, "validation");
});

Deno.test("SafeImageDownloader follows safe redirects", async () => {
  const calls: string[] = [];
  const downloader = new SafeImageDownloader({
    resolveHostname: async () => ["93.184.216.34"],
    fetchImpl: ((input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/old.png")) {
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "https://example.com/new.png" },
          }),
        );
      }
      return Promise.resolve(
        new Response(new Uint8Array([1, 2]), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      );
    }) as typeof fetch,
  });

  const result = await downloader.download("https://example.com/old.png");
  assertEquals(calls, [
    "https://example.com/old.png",
    "https://example.com/new.png",
  ]);
  assertEquals(result.bytes.byteLength, 2);
});
