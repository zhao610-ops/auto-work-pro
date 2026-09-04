import { jsonrepair } from "jsonrepair";

export function stripThinkTags(input: string): string {
  return input
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think\b[^>]*>/gi, "")
    .trim();
}

export function stripMarkdownFence(input: string): string {
  return input
    .replace(/^\s*```(?:[\w-]+)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .replace(/^\s*```\s*$/gm, "")
    .trim();
}

export function cleanLLMText(input: string): string {
  return stripMarkdownFence(stripThinkTags(input))
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim();
}

export function cleanLLMTitle(input: string): string {
  const cleaned = cleanLLMText(input);
  const candidates = cleaned
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*[-*#>\d.、）)]\s*/, "")
        .replace(/^(标题|主标题|建议标题|文章标题)\s*[:：]\s*/i, "")
        .replace(/^["'“”‘’]+|["'“”‘’。]+$/g, "")
        .trim()
    )
    .filter(Boolean)
    .filter((line) => !isReasoningLine(line));
  const title = candidates.at(-1) ?? "";
  if (!title || isReasoningLine(title)) {
    return "";
  }
  return title
    .replace(/[。.!！?？]+$/g, "")
    .trim()
    .slice(0, 48);
}

export function cleanLLMJsonText(input: string): string {
  const cleaned = stripMarkdownFence(stripThinkTags(input));
  const jsonObject = extractFirstJsonObject(cleaned);
  return jsonObject ?? cleaned.trim();
}

export function parseLLMJson<T = unknown>(input: string): T {
  const cleaned = stripMarkdownFence(stripThinkTags(input));
  const candidates = uniqueCandidates([
    cleanLLMJsonText(input),
    extractFirstJsonValue(cleaned, false),
    extractFirstJsonValue(cleaned, true),
  ]);
  const errors: string[] = [];

  for (const candidate of candidates) {
    for (
      const repaired of uniqueCandidates([
        candidate,
        repairCommonJsonIssues(candidate),
      ])
    ) {
      try {
        return JSON.parse(repaired) as T;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  throw new Error(
    `无法解析 LLM JSON 输出: ${errors.at(-1) ?? "未找到 JSON 片段"}`,
  );
}

function isReasoningLine(line: string): boolean {
  return /^(让我|我来|我们先|根据以上|以下是|分析|推理|思考|步骤|结论[:：]|输出[:：])/i
    .test(line) ||
    /<think\b|<\/think>/i.test(line);
}

export function normalizeLLMResponse<T>(response: T): T {
  if (!response || typeof response !== "object") {
    return response;
  }

  const maybeResponse = response as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };

  if (!Array.isArray(maybeResponse.choices)) {
    return response;
  }

  for (const choice of maybeResponse.choices) {
    const content = choice?.message?.content;
    if (typeof content === "string") {
      choice.message!.content = stripMarkdownFence(stripThinkTags(content));
    }
  }

  return response;
}

function extractFirstJsonObject(input: string): string | null {
  const value = extractFirstJsonValue(input, false);
  return value?.trimStart().startsWith("{") ? value : null;
}

function extractFirstJsonValue(
  input: string,
  allowUnbalanced: boolean,
): string | null {
  const objectStart = input.indexOf("{");
  const arrayStart = input.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  if (start < 0) return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = start; index < input.length; index++) {
    const char = input[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      stack.push("}");
    } else if (char === "[") {
      stack.push("]");
    } else if (char === "}" || char === "]") {
      if (stack.at(-1) === char) {
        stack.pop();
      }
      if (stack.length === 0) {
        return input.slice(start, index + 1);
      }
    }
  }

  if (allowUnbalanced && stack.length > 0) {
    return input.slice(start) + (inString ? '"' : "") + stack.reverse().join(
      "",
    );
  }

  return null;
}

function repairCommonJsonIssues(input: string): string {
  const commonRepaired = removeTrailingCommas(
    escapeControlCharactersInStrings(input.trim()),
  );
  try {
    return jsonrepair(commonRepaired);
  } catch {
    return commonRepaired;
  }
}

function escapeControlCharactersInStrings(input: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      output += char;
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      output += char;
      continue;
    }

    if (inString) {
      const code = char.charCodeAt(0);
      if (char === "\n") {
        output += "\\n";
        continue;
      }
      if (char === "\r") {
        output += "\\r";
        continue;
      }
      if (char === "\t") {
        output += "\\t";
        continue;
      }
      if (code < 0x20) {
        output += `\\u${code.toString(16).padStart(4, "0")}`;
        continue;
      }
    }

    output += char;
  }

  return output;
}

function removeTrailingCommas(input: string): string {
  let previous = input;
  while (true) {
    const next = previous.replace(/,\s*([}\]])/g, "$1");
    if (next === previous) return next;
    previous = next;
  }
}

function uniqueCandidates(
  candidates: Array<string | null | undefined>,
): string[] {
  return [
    ...new Set(
      candidates
        .map((candidate) => candidate?.trim())
        .filter((candidate): candidate is string => Boolean(candidate)),
    ),
  ];
}
