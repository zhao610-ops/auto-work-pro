import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { ChatCompletionOptions, LLMProvider } from "@src/core/ports/llm.ts";
import { WeixinDynamicHtmlGenerator } from "@src/features/weixin-article/rendering/dynamic/dynamic-html.generator.ts";
import { WeixinTemplate } from "@src/features/weixin-article/domain/renderable-article.ts";

const articles: WeixinTemplate[] = [{
  id: "1",
  title: "生成器测试",
  content: "OpenAI发布新模型。",
  url: "https://example.com",
  publishDate: "2026-05-20",
  metadata: {},
  keywords: ["OpenAI"],
}];

function createGenerator(content: string): WeixinDynamicHtmlGenerator {
  const llm: LLMProvider = {
    initialize: () => Promise.resolve(),
    refresh: () => Promise.resolve(),
    setModel: () => {},
    createChatCompletion: () =>
      Promise.resolve({
        choices: [{
          message: {
            content,
          },
        }],
      }),
  };

  return new WeixinDynamicHtmlGenerator(llm);
}

Deno.test("WeixinDynamicHtmlGenerator returns processed html from valid JSON", async () => {
  const generator = createGenerator(`
<think>先确定排版方向。</think>
${
    JSON.stringify({
      html:
        '<section><div class="x"><p>OpenAI发布新模型</p><a href="https://example.com">来源</a></div></section>',
      theme: "tech",
      notes: "ok",
    })
  }
`);

  const html = await generator.generate(articles);

  assertStringIncludes(html, "OpenAI 发布新模型");
  assertStringIncludes(html, "参考链接");
  assertStringIncludes(html, "<section");
});

Deno.test("WeixinDynamicHtmlGenerator uses a bounded LLM call budget", async () => {
  let chatOptions: ChatCompletionOptions | undefined;
  const llm: LLMProvider = {
    initialize: () => Promise.resolve(),
    refresh: () => Promise.resolve(),
    setModel: () => {},
    createChatCompletion: (_messages, options) => {
      chatOptions = options;
      return Promise.resolve({
        choices: [{
          message: {
            content: JSON.stringify({
              html: "<section><p>OpenAI发布新模型</p></section>",
            }),
          },
        }],
      });
    },
  };
  const generator = new WeixinDynamicHtmlGenerator(llm);

  await generator.generate(articles);

  assertEquals(chatOptions?.timeoutMs, 120_000);
  assertEquals(chatOptions?.maxAttempts, 2);
});

Deno.test("WeixinDynamicHtmlGenerator rejects invalid JSON", async () => {
  const generator = createGenerator("not json");

  await assertRejects(
    () => generator.generate(articles),
    Error,
    "JSON 对象",
  );
});

Deno.test("WeixinDynamicHtmlGenerator rejects empty html", async () => {
  const generator = createGenerator(JSON.stringify({ html: "" }));

  await assertRejects(
    () => generator.generate(articles),
    Error,
    "缺少 html 字段",
  );
});
