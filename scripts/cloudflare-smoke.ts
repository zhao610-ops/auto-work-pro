import {
  initializeAppConfig,
  parseConfigArgs,
} from "@src/utils/config/app-config.ts";

interface SmokeArgs {
  url: string;
  apiKey: string;
  timeoutMs: number;
  intervalMs: number;
  maxArticles?: number;
  dryRun: boolean;
  forcePublish: boolean;
}

interface RunResponse {
  runId?: string;
  error?: string;
}

interface RunDetailResponse {
  run?: {
    runId: string;
    status: string;
    error?: string;
    artifacts?: Array<{ key: string; label?: string; contentType?: string }>;
    steps?: Array<{ name: string; status: string; error?: string }>;
  };
  error?: string;
}

const { configPath, args } = parseConfigArgs(Deno.args);
const smokeArgs = await parseSmokeArgs(args, configPath);
await runSmoke(smokeArgs);

async function runSmoke(options: SmokeArgs): Promise<void> {
  const baseUrl = options.url.replace(/\/+$/, "");
  console.log(`Cloudflare smoke target: ${baseUrl}`);

  const health = await requestJson(`${baseUrl}/api/health`, {
    method: "GET",
    apiKey: options.apiKey,
  });
  if (!health.ok) {
    console.error(JSON.stringify(health, null, 2));
    throw new Error("Cloudflare health check failed");
  }
  console.log("Health check OK");

  const run = await requestJson<RunResponse>(`${baseUrl}/api/runs`, {
    method: "POST",
    apiKey: options.apiKey,
    body: {
      dryRun: options.dryRun,
      forcePublish: options.forcePublish,
      trigger: "manual",
      maxArticles: options.maxArticles,
    },
  });
  if (!run.runId) {
    throw new Error(run.error ?? "Cloudflare run was not created");
  }
  console.log(
    `Created ${options.dryRun ? "dry-run" : "publish"} workflow: ${run.runId}`,
  );

  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const detail = await requestJson<RunDetailResponse>(
      `${baseUrl}/api/runs/${encodeURIComponent(run.runId)}`,
      { method: "GET", apiKey: options.apiKey },
    );
    const record = detail.run;
    if (!record) {
      throw new Error(detail.error ?? `Run not found: ${run.runId}`);
    }

    const steps = record.steps ?? [];
    const stepSummary = steps
      .map((step) => `${step.name}:${step.status}`)
      .join(", ");
    console.log(
      `Run ${record.status}${stepSummary ? ` | ${stepSummary}` : ""}`,
    );

    if (record.status === "succeeded") {
      console.log(
        options.dryRun
          ? "Cloudflare workflow dry-run succeeded"
          : "Cloudflare workflow publish succeeded",
      );
      if (record.artifacts?.length) {
        console.log("Artifacts:");
        for (const artifact of record.artifacts) {
          console.log(
            `- ${
              artifact.label ?? artifact.contentType ?? "artifact"
            }: ${artifact.key}`,
          );
        }
      }
      return;
    }

    if (record.status === "failed" || record.status === "cancelled") {
      console.error(JSON.stringify(record, null, 2));
      throw new Error(record.error ?? `Run ${record.status}`);
    }

    await delay(options.intervalMs);
  }

  throw new Error(
    `Cloudflare workflow did not finish within ${options.timeoutMs}ms`,
  );
}

async function requestJson<T = Record<string, unknown>>(
  url: string,
  options: {
    method: "GET" | "POST";
    apiKey: string;
    body?: unknown;
  },
): Promise<T> {
  const response = await fetch(url, {
    method: options.method,
    headers: {
      "Authorization": `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `HTTP ${response.status} ${response.statusText}: non-JSON response: ${
        text.slice(0, 500)
      }`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText}: ${JSON.stringify(json)}`,
    );
  }
  return json as T;
}

async function parseSmokeArgs(
  args: string[],
  configPath?: string,
): Promise<SmokeArgs> {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      const [key, inlineValue] = arg.slice(2).split("=", 2);
      if (inlineValue !== undefined) {
        values.set(key, inlineValue);
        continue;
      }
      const next = args[index + 1];
      if (next && !next.startsWith("--")) {
        values.set(key, next);
        index++;
      } else {
        values.set(key, "true");
      }
    }
  }

  const url = values.get("url") ?? Deno.env.get("TRENDPUBLISH_CF_URL") ?? "";
  const apiKey = values.get("api-key") ??
    Deno.env.get("TRENDPUBLISH_API_KEY") ??
    Deno.env.get("SERVER_API_KEY") ??
    await readApiKeyFromConfig(configPath);
  if (!url) {
    throw new Error(
      "缺少 Cloudflare Worker URL。使用 --url 或 TRENDPUBLISH_CF_URL。",
    );
  }
  if (!apiKey) {
    throw new Error(
      "缺少 API Key。使用 --api-key、TRENDPUBLISH_API_KEY 或 SERVER_API_KEY。",
    );
  }

  return {
    url,
    apiKey,
    timeoutMs: Number(values.get("timeout-ms") ?? 10 * 60 * 1000),
    intervalMs: Number(values.get("interval-ms") ?? 5000),
    maxArticles: values.has("max-articles")
      ? Number(values.get("max-articles"))
      : 1,
    dryRun: !values.has("publish"),
    forcePublish: values.has("force-publish"),
  };
}

async function readApiKeyFromConfig(configPath?: string): Promise<string> {
  try {
    const config = await initializeAppConfig({ configPath });
    return config.server.apiKey;
  } catch {
    return "";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
