import { assertEquals } from "@std/assert";
import { join } from "node:path";

const ROOT = Deno.cwd();

Deno.test("core ports do not import integrations", async () => {
  const violations = await findImportViolations("src/core/ports", [
    "@src/integrations",
  ]);

  assertEquals(violations, []);
});

Deno.test("modules do not import integrations", async () => {
  const violations = await findImportViolations("src/modules", [
    "@src/integrations",
  ]);

  assertEquals(violations, []);
});

Deno.test("modules do not import features", async () => {
  const violations = await findImportViolations("src/modules", [
    "@src/features",
  ]);

  assertEquals(violations, []);
});

Deno.test("weixin article domain does not import integrations", async () => {
  const violations = await findImportViolations(
    "src/features/weixin-article/domain",
    ["@src/integrations"],
  );

  assertEquals(violations, []);
});

Deno.test("weixin article feature does not import infrastructure", async () => {
  const violations = await findImportViolations(
    "src/features/weixin-article",
    ["@src/integrations", "@src/db", "@src/utils/config/app-config"],
  );

  assertEquals(violations, []);
});

Deno.test("weixin article rendering does not import integrations", async () => {
  const violations = await findImportViolations(
    "src/features/weixin-article/rendering",
    ["@src/integrations"],
  );

  assertEquals(violations, []);
});

Deno.test("weixin article services do not use global singleton defaults", async () => {
  const violations = await findTextViolations(
    "src/features/weixin-article/services",
    [
      ".getInstance(",
    ],
  );

  assertEquals(violations, []);
});

Deno.test("legacy database module is removed", async () => {
  const exists = await pathExists(join(ROOT, "src/db"));

  assertEquals(exists, false);
});

Deno.test("resolvers do not expose global getInstance", async () => {
  const violations = await findTextViolations("src/integrations", [
    "Resolver.getInstance(",
    "static getInstance(",
  ]);

  assertEquals(violations, []);
});

Deno.test("core ports do not use any", async () => {
  const violations = await findTextViolations("src/core/ports", [
    " any",
    ":any",
    "<any",
  ]);

  assertEquals(violations, []);
});

async function findImportViolations(
  relativeDir: string,
  forbiddenImports: string[],
): Promise<string[]> {
  return await findTextViolations(relativeDir, forbiddenImports);
}

async function findTextViolations(
  relativeDir: string,
  forbiddenText: string[],
): Promise<string[]> {
  const violations: string[] = [];
  for await (const path of walkTsFiles(join(ROOT, relativeDir))) {
    const content = await Deno.readTextFile(path);
    for (const text of forbiddenText) {
      if (content.includes(text)) {
        violations.push(`${path.replace(`${ROOT}/`, "")}: ${text}`);
      }
    }
  }
  return violations.sort();
}

async function* walkTsFiles(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) {
      yield* walkTsFiles(path);
      continue;
    }
    if (entry.isFile && path.endsWith(".ts")) {
      yield path;
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
