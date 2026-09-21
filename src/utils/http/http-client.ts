import { Logger } from "@zilla/logger";
import { redactSensitiveText } from "@src/utils/security/redact.ts";

const logger = new Logger("http-client");

const FETCH_PROXY_URL_ENV = "TRENDPUBLISH_FETCH_PROXY_URL";
const FETCH_PROXY_HOSTS_ENV = "TRENDPUBLISH_FETCH_PROXY_HOSTS";

let proxyClient: Deno.HttpClient | undefined;
let proxyClientUrl: string | undefined;

/** 仅将白名单中的海外抓取域名转发至代理，避免发布和国内接口绕行。 */
export function fetchWithConfiguredProxy(
  input: string | URL,
  options: RequestInit = {},
): Promise<Response> {
  const url = input instanceof URL ? input : new URL(input);
  const client = getProxyClientForHost(url.hostname);
  return client ? fetch(url, { ...options, client }) : fetch(url, options);
}

function getProxyClientForHost(hostname: string): Deno.HttpClient | undefined {
  const proxyUrl = Deno.env.get(FETCH_PROXY_URL_ENV)?.trim();
  const allowedHosts = Deno.env.get(FETCH_PROXY_HOSTS_ENV)
    ?.split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean) ?? [];

  if (!proxyUrl || !allowedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
    return undefined;
  }

  if (!proxyClient || proxyClientUrl !== proxyUrl) {
    proxyClient?.close();
    proxyClient = Deno.createHttpClient({ proxy: { url: proxyUrl } });
    proxyClientUrl = proxyUrl;
  }
  return proxyClient;
}

// 自定义错误类型
export class HttpError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: Response,
    public url?: string,
    public method?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class TimeoutError extends HttpError {
  constructor(url: string, timeout: number) {
    super(`请求超时 (${timeout}ms): ${url}`);
    this.name = "TimeoutError";
  }
}

export class NetworkError extends HttpError {
  constructor(url: string, originalError: Error) {
    super(`网络错误: ${originalError.message}`, undefined, undefined, url);
    this.name = "NetworkError";
  }
}

interface RequestOptions extends RequestInit {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

export class HttpClient {
  private static instance: HttpClient;

  private constructor() {}

  public static getInstance(): HttpClient {
    if (!HttpClient.instance) {
      HttpClient.instance = new HttpClient();
    }
    return HttpClient.instance;
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestOptions = {},
  ): Promise<Response> {
    const { timeout = 30000, ...fetchOptions } = options;

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetchWithConfiguredProxy(url, {
        ...fetchOptions,
        signal: controller.signal,
      });
      clearTimeout(id);
      return response;
    } catch (error) {
      clearTimeout(id);
      if (error instanceof Error && error.name === "AbortError") {
        throw new TimeoutError(url, timeout);
      }
      throw new NetworkError(url, error as Error);
    }
  }

  private async retryFetch(
    url: string,
    options: RequestOptions = {},
  ): Promise<Response> {
    const { retries = 3, retryDelay = 1000, ...fetchOptions } = options;

    let lastError: HttpError | null = null;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await this.fetchWithTimeout(url, fetchOptions);

        if (!response.ok) {
          throw new HttpError(
            `HTTP ${response.status} - ${response.statusText}`,
            response.status,
            response,
            url,
            fetchOptions.method || "GET",
          );
        }

        return response;
      } catch (error) {
        lastError = error instanceof HttpError ? error : new HttpError(
          (error as Error).message,
          undefined,
          undefined,
          url,
          fetchOptions.method || "GET",
        );

        const remainingAttempts = retries - attempt - 1;
        logger.warn(
          `请求失败 (${lastError.name}): ${
            redactSensitiveText(lastError.message)
          } - 剩余重试次数: ${remainingAttempts}`,
          {
            url: redactSensitiveText(url),
            method: fetchOptions.method || "GET",
            attempt: attempt + 1,
            maxAttempts: retries,
            error: redactSensitiveText(lastError),
          },
        );

        if (remainingAttempts > 0) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
      }
    }

    throw lastError || new HttpError("未知错误");
  }

  public async request<T>(
    url: string,
    options: RequestOptions = {},
  ): Promise<T> {
    try {
      const response = await this.retryFetch(url, options);
      const data = await response.json();
      return data as T;
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(
        `请求处理失败: ${(error as Error).message}`,
        undefined,
        undefined,
        url,
        options.method || "GET",
      );
    }
  }

  public async healthCheck(url: string): Promise<boolean> {
    try {
      await this.fetchWithTimeout(url, {
        method: "HEAD",
        timeout: 5000,
      });
      return true;
    } catch (error) {
      logger.error(`健康检查失败: ${redactSensitiveText(url)}`, {
        error: error instanceof HttpError
          ? redactSensitiveText(error)
          : redactSensitiveText(new HttpError((error as Error).message)),
        url: redactSensitiveText(url),
        timestamp: new Date().toISOString(),
      });
      return false;
    }
  }
}
