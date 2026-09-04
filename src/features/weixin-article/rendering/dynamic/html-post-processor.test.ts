import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { postProcessDynamicHtml } from "@src/features/weixin-article/rendering/dynamic/html-post-processor.ts";

Deno.test("postProcessDynamicHtml cleans incompatible tags and attributes", () => {
  const result = postProcessDynamicHtml(`
    \`\`\`html
    <div class="card" id="root" onclick="alert(1)" style="color:#111;">
      <!-- 不应该保留到公众号正文 -->
      <style>.x{color:red}</style>
      <script>alert(1)</script>
      <p>AI正在改变软件工程</p>
      <a href="https://example.com/source">原文</a>
    </div>
    \`\`\`
  `);

  assert(result.html.startsWith("<section"));
  assert(!/<\/?div\b/i.test(result.html));
  assert(!/<style\b/i.test(result.html));
  assert(!/<script\b/i.test(result.html));
  assert(!/\sclass=/i.test(result.html));
  assert(!/\sid=/i.test(result.html));
  assert(!/\sonclick=/i.test(result.html));
  assert(!/<!--/.test(result.html));
  assertStringIncludes(result.html, "AI 正在改变软件工程");
  assertStringIncludes(result.html, "参考链接");
  assertEquals(result.footnotes, ["https://example.com/source"]);
});

Deno.test("postProcessDynamicHtml converts lists and sanitizes images", () => {
  const result = postProcessDynamicHtml(`
    <section>
      <ul><li>提升效率</li><li>降低错误</li></ul>
      <img src="https://img.example.com/a.png" alt="截图" class="x" style="width:10px" />
    </section>
  `);

  assert(!/<\/?ul\b/i.test(result.html));
  assert(!/<\/?li\b/i.test(result.html));
  assertStringIncludes(result.html, "<p style=");
  assertStringIncludes(result.html, 'src="https://img.example.com/a.png"');
  assertStringIncludes(result.html, "max-width:100%");
  assert(!/\sclass=/i.test(result.html));
});

Deno.test("postProcessDynamicHtml rejects non-section root", () => {
  assertThrows(
    () => postProcessDynamicHtml("<p>正文</p>"),
    Error,
    "根节点必须是 section",
  );
});
