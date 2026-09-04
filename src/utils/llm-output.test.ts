import { assertEquals } from "@std/assert";
import {
  cleanLLMJsonText,
  cleanLLMText,
  cleanLLMTitle,
  normalizeLLMResponse,
  parseLLMJson,
  stripMarkdownFence,
  stripThinkTags,
} from "./llm-output.ts";

Deno.test("stripThinkTags removes closed reasoning blocks", () => {
  assertEquals(
    stripThinkTags("<think>推理过程</think>\n最终结果"),
    "最终结果",
  );
});

Deno.test("cleanLLMJsonText extracts JSON after reasoning and prose", () => {
  const result = cleanLLMJsonText(`
<think>
先分析一下。
没有闭合标签也不应该影响 JSON 提取。

{"title":"标题","content":"正文"}
`);

  assertEquals(result, '{"title":"标题","content":"正文"}');
});

Deno.test("parseLLMJson repairs common structured output issues", () => {
  const parsed = parseLLMJson<{
    title: string;
    summary: string;
    items: string[];
  }>(`
Let me analyze the sources first.
\`\`\`json
{
  "title": "标题",
  "summary": "第一行
第二行",
  "items": ["a", "b",],
}
`);

  assertEquals(parsed, {
    title: "标题",
    summary: "第一行\n第二行",
    items: ["a", "b"],
  });
});

Deno.test("parseLLMJson can close lightly truncated JSON fragments", () => {
  const parsed = parseLLMJson<{ clusters: Array<{ id: string }> }>(`
<think>分析一下</think>
{"clusters":[{"id":"topic-1"}
`);

  assertEquals(parsed, { clusters: [{ id: "topic-1" }] });
});

Deno.test("cleanLLMText strips think tags, fences and wrapping quotes", () => {
  const result = cleanLLMText(`
\`\`\`text
<think>内部分析</think>
"今日 AI 速递"
\`\`\`
`);

  assertEquals(result, "今日 AI 速递");
});

Deno.test("cleanLLMTitle picks final title and drops reasoning labels", () => {
  const result = cleanLLMTitle(`
<think>让我分析这些文章。</think>
以下是建议：
标题：OpenAI 更新开发者工具链
`);

  assertEquals(result, "OpenAI 更新开发者工具链");
});

Deno.test("cleanLLMTitle rejects reasoning-only output", () => {
  assertEquals(cleanLLMTitle("<think>让我分析这几篇文章</think>"), "");
});

Deno.test("stripMarkdownFence handles language fences", () => {
  assertEquals(stripMarkdownFence('```json\n{"ok":true}\n```'), '{"ok":true}');
});

Deno.test("normalizeLLMResponse cleans assistant message content", () => {
  const response = {
    choices: [{
      message: {
        content: "```text\n<think>推理</think>\n最终答案\n```",
      },
    }],
  };

  normalizeLLMResponse(response);

  assertEquals(response.choices[0].message.content, "最终答案");
});
