import { renderAndSaveWeixinPreview } from "../../../../../scripts/preview.weixin.ts";

Deno.test("generate weixin template previews", async () => {
  await renderAndSaveWeixinPreview();
});
