import type { ToutiaoRelayConfig } from "./types.ts";

export function loadToutiaoRelayConfig(): ToutiaoRelayConfig {
  const port = Number(
    Deno.env.get("TOUTIAO_RELAY_PORT") ?? Deno.env.get("PORT") ?? "8091",
  );
  const profileDir = Deno.env.get("TOUTIAO_PROFILE_DIR") ??
    "./data/toutiao/browser-data";
  const screenshotsDir = Deno.env.get("TOUTIAO_SCREENSHOTS_DIR") ??
    "./data/toutiao/screenshots";
  const statePath = Deno.env.get("TOUTIAO_STATE_PATH") ??
    "./data/toutiao/article-records.json";
  const token = Deno.env.get("TOUTIAO_RELAY_TOKEN") ??
    Deno.env.get("TRENDPUBLISH_API_KEY") ??
    "";

  return {
    port,
    token,
    profileDir,
    screenshotsDir,
    statePath,
    defaultScheduleTime:
      Deno.env.get("TOUTIAO_DEFAULT_SCHEDULE_TIME")?.trim() ||
      "11:00",
    headless: readBooleanEnv("TOUTIAO_HEADLESS", false),
    chromeExecutablePath: optionalEnv("TOUTIAO_CHROME_EXECUTABLE_PATH"),
    chromeChannel: optionalEnv("TOUTIAO_CHROME_CHANNEL") ?? "chrome",
  };
}

function optionalEnv(name: string): string | undefined {
  const value = Deno.env.get(name)?.trim();
  return value ? value : undefined;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const value = Deno.env.get(name)?.trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}
