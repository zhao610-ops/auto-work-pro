import { assertEquals } from "@std/assert";
import { WeixinImageProcessor } from "@src/utils/image/image-processor.ts";
import type { ContentImageUploader } from "@src/core/ports/content-publisher.ts";
import { SafeImageDownloader } from "@src/utils/image/safe-image-downloader.ts";

Deno.test("WeixinImageProcessor decodes escaped signed URLs and avoids unsigned duplicate extraction", async () => {
  const originalFetch = globalThis.fetch;
  const fetchedUrls: string[] = [];
  const uploadedUrls: string[] = [];
  const signedUrl =
    "https://example.com/path/image.png?Expires=1&OSSAccessKeyId=key&Signature=sig";
  const escapedUrl = signedUrl.replace(/&/g, "&amp;");

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    fetchedUrls.push(`${init?.method ?? "GET"} ${url}`);
    return Promise.resolve(
      new Response(init?.method === "HEAD" ? null : new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );
  }) as typeof fetch;

  const uploader: ContentImageUploader = {
    async uploadContentImage(imageUrl) {
      uploadedUrls.push(imageUrl);
      return "https://mmbiz.qpic.cn/uploaded.png";
    },
  };

  try {
    const processor = new WeixinImageProcessor(
      uploader,
      new SafeImageDownloader({
        fetchImpl: globalThis.fetch,
        resolveHostname: async () => ["93.184.216.34"],
      }),
    );
    const result = await processor.processContent(
      `<p><img src="${escapedUrl}" alt="test"></p>`,
    );

    assertEquals(uploadedUrls, [signedUrl]);
    assertEquals(fetchedUrls, [`GET ${signedUrl}`]);
    assertEquals(result.results.length, 1);
    assertEquals(result.results[0].originalUrl, escapedUrl);
    assertEquals(
      result.content.includes('src="https://mmbiz.qpic.cn/uploaded.png"'),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
