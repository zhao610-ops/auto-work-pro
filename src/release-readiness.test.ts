import { assertEquals } from "@std/assert";

const RELEASE_DOC_FILES = [
  "README.md",
  "CHANGELOG.md",
  "docs/index.md",
  "docs/getting-started.md",
  "docs/configuration.md",
  "docs/architecture.md",
  "docs/deployment.md",
  "docs/help.md",
  "docs/templates.md",
  "docs/api/json-rpc-api.md",
  "trendpublish.config.example.ts",
  "deno.json",
];

const FORBIDDEN_RELEASE_TEXT = [
  ".env",
  "ARTICLE_TEMPLATE_TYPE",
  "modules/render/weixin",
  "src/modules/render",
  "workflow:test",
  "src/test.ts",
  "aibench",
  "hellogithub",
  "xunfei",
  "Xunfei",
  "讯飞",
  "src/main.ts",
  "ConfigManager",
  "config-manager",
];

Deno.test("release docs and examples do not reference old config or entrypoints", async () => {
  const violations: string[] = [];

  for (const file of RELEASE_DOC_FILES) {
    const content = await Deno.readTextFile(file);
    for (const text of FORBIDDEN_RELEASE_TEXT) {
      if (content.includes(text)) {
        violations.push(`${file}: ${text}`);
      }
    }
  }

  assertEquals(violations, []);
});

Deno.test("temporary preview and dry-run outputs are ignored", async () => {
  const gitignore = await Deno.readTextFile(".gitignore");
  assertEquals(gitignore.includes("src/temp/"), true);
});

Deno.test("legacy environment configuration guide is removed", async () => {
  assertEquals(await exists("ENV_CONFIGURATION.md"), false);
});

Deno.test("config model does not keep legacy fallback switches", async () => {
  const violations: string[] = [];
  const forbiddenText = [
    ["article", ".template ??"].join(""),
    ["article", ".promptProfile ??"].join(""),
    ["providers", ".vector.embedding.enabled"].join(""),
    ["bark?: ", "boolean"].join(""),
    ["dingtalk?: ", "boolean"].join(""),
    ["feishu?: ", "boolean"].join(""),
    ["resolve", "NotifyConfig"].join(""),
  ];

  for await (const file of sourceFiles(["src", "scripts"])) {
    const content = await Deno.readTextFile(file);
    for (const text of forbiddenText) {
      if (content.includes(text)) {
        violations.push(`${file}: ${text}`);
      }
    }
  }

  assertEquals(violations, []);
});

Deno.test("public config examples use location-independent imports", async () => {
  const violations: string[] = [];
  const forbiddenImports = [
    `from "./src/utils/config/define-config.ts"`,
    `from "../src/utils/config/define-config.ts"`,
  ];

  for (const file of RELEASE_DOC_FILES) {
    const content = await Deno.readTextFile(file);
    for (const text of forbiddenImports) {
      if (content.includes(text)) {
        violations.push(`${file}: ${text}`);
      }
    }
  }

  assertEquals(violations, []);
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

async function* sourceFiles(roots: string[]): AsyncGenerator<string> {
  for (const root of roots) {
    for await (const file of walkFiles(root)) {
      if (file.endsWith(".ts") && !file.endsWith("release-readiness.test.ts")) {
        yield file;
      }
    }
  }
}

async function* walkFiles(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      yield* walkFiles(path);
    } else if (entry.isFile) {
      yield path;
    }
  }
}
