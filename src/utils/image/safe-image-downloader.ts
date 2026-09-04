import { ProviderError } from "@src/core/errors/provider-error.ts";

export interface SafeImageDownloaderOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  allowedContentTypes?: string[];
  fetchImpl?: typeof fetch;
  resolveHostname?: (hostname: string) => Promise<string[]>;
}

export interface SafeImageDownloadResult {
  url: string;
  contentType: string;
  bytes: Uint8Array;
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

export class SafeImageDownloader {
  constructor(private readonly options: SafeImageDownloaderOptions = {}) {}

  async download(url: string): Promise<SafeImageDownloadResult> {
    return await this.downloadWithRedirects(url, 0);
  }

  private async downloadWithRedirects(
    inputUrl: string,
    redirectCount: number,
  ): Promise<SafeImageDownloadResult> {
    const url = await this.validateUrl(inputUrl);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    try {
      const response = await (this.options.fetchImpl ?? fetch)(url.href, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      });

      if (isRedirect(response.status)) {
        if (
          redirectCount >= (this.options.maxRedirects ?? DEFAULT_MAX_REDIRECTS)
        ) {
          throw new ProviderError({
            provider: "safe-image-downloader",
            kind: "validation",
            message: "图片重定向次数过多",
            statusCode: response.status,
          });
        }
        const location = response.headers.get("location");
        if (!location) {
          throw new ProviderError({
            provider: "safe-image-downloader",
            kind: "invalid_response",
            message: "图片重定向响应缺少 Location",
            statusCode: response.status,
          });
        }
        return await this.downloadWithRedirects(
          new URL(location, url).href,
          redirectCount + 1,
        );
      }

      if (!response.ok) {
        throw new ProviderError({
          provider: "safe-image-downloader",
          kind: "invalid_response",
          message: `图片下载失败: HTTP ${response.status}`,
          statusCode: response.status,
        });
      }

      const contentType = normalizeContentType(
        response.headers.get("content-type"),
      );
      if (!this.isAllowedContentType(contentType)) {
        throw new ProviderError({
          provider: "safe-image-downloader",
          kind: "validation",
          message: `无效的Content-Type: ${contentType ?? "unknown"}`,
        });
      }

      const maxBytes = this.options.maxBytes ?? DEFAULT_MAX_BYTES;
      const contentLength = parseContentLength(
        response.headers.get("content-length"),
      );
      if (contentLength !== undefined && contentLength > maxBytes) {
        throw new ProviderError({
          provider: "safe-image-downloader",
          kind: "validation",
          message: `图片大小超过限制: ${formatBytes(contentLength)} > ${
            formatBytes(maxBytes)
          }`,
        });
      }

      const bytes = await readBodyWithLimit(response, maxBytes);
      return { url: url.href, contentType: contentType!, bytes };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new ProviderError({
          provider: "safe-image-downloader",
          kind: "timeout",
          message: `图片下载超时: ${url.href}`,
          cause: error,
        });
      }
      throw new ProviderError({
        provider: "safe-image-downloader",
        kind: "network",
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async validateUrl(inputUrl: string): Promise<URL> {
    let url: URL;
    try {
      url = new URL(inputUrl);
    } catch {
      throw new ProviderError({
        provider: "safe-image-downloader",
        kind: "validation",
        message: "图片 URL 无效",
      });
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new ProviderError({
        provider: "safe-image-downloader",
        kind: "validation",
        message: `不支持的图片 URL 协议: ${url.protocol}`,
      });
    }

    await assertPublicHostname(url.hostname, this.options.resolveHostname);
    return url;
  }

  private isAllowedContentType(contentType: string | undefined): boolean {
    if (!contentType) return false;
    return (this.options.allowedContentTypes ?? DEFAULT_ALLOWED_CONTENT_TYPES)
      .some((allowed) => contentType === allowed);
  }
}

async function assertPublicHostname(
  hostname: string,
  resolver?: (hostname: string) => Promise<string[]>,
): Promise<void> {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    throwUnsafeHost(hostname);
  }

  const literalIp = parseIpLiteral(normalized);
  if (literalIp && isPrivateOrReservedIp(literalIp)) {
    throwUnsafeHost(hostname);
  }

  const resolve = resolver ?? defaultResolveHostname;
  const resolved = await resolve(normalized);
  for (const address of resolved) {
    const parsed = parseIpLiteral(address);
    if (parsed && isPrivateOrReservedIp(parsed)) {
      throwUnsafeHost(hostname);
    }
  }
}

async function defaultResolveHostname(hostname: string): Promise<string[]> {
  const maybeDeno = globalThis as typeof globalThis & {
    Deno?: {
      resolveDns?: (name: string, type: "A" | "AAAA") => Promise<string[]>;
    };
  };
  if (!maybeDeno.Deno?.resolveDns) return [];
  const results = await Promise.allSettled([
    maybeDeno.Deno.resolveDns(hostname, "A"),
    maybeDeno.Deno.resolveDns(hostname, "AAAA"),
  ]);
  return results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  );
}

function throwUnsafeHost(hostname: string): never {
  throw new ProviderError({
    provider: "safe-image-downloader",
    kind: "validation",
    message: `不允许下载内网或本机图片地址: ${hostname}`,
  });
}

type IpLiteral =
  | { family: "ipv4"; parts: number[] }
  | { family: "ipv6"; value: string };

function parseIpLiteral(value: string): IpLiteral | null {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) {
    const parts = value.split(".").map(Number);
    if (
      parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ) {
      return { family: "ipv4", parts };
    }
  }
  const withoutBrackets = value.replace(/^\[|\]$/g, "");
  if (withoutBrackets.includes(":")) {
    return { family: "ipv6", value: withoutBrackets.toLowerCase() };
  }
  return null;
}

function isPrivateOrReservedIp(ip: IpLiteral): boolean {
  if (ip.family === "ipv6") {
    const value = ip.value;
    return value === "::1" || value === "::" || value.startsWith("fc") ||
      value.startsWith("fd") || value.startsWith("fe80:");
  }

  const [a, b] = ip.parts;
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 ||
    status === 307 || status === 308;
}

function normalizeContentType(value: string | null): string | undefined {
  return value?.split(";")[0].trim().toLowerCase() || undefined;
}

function parseContentLength(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

async function readBodyWithLimit(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!response.body) {
    return new Uint8Array(await response.arrayBuffer());
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ProviderError({
        provider: "safe-image-downloader",
        kind: "validation",
        message: `图片大小超过限制: > ${formatBytes(maxBytes)}`,
      });
    }
    chunks.push(value);
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function formatBytes(value: number): string {
  return `${(value / 1024 / 1024).toFixed(2)}MB`;
}
