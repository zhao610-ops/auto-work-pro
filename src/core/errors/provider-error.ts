export type ProviderErrorKind =
  | "auth"
  | "quota"
  | "rate_limit"
  | "network"
  | "timeout"
  | "invalid_response"
  | "empty_content"
  | "validation";

export interface ProviderErrorOptions {
  provider: string;
  kind: ProviderErrorKind;
  message: string;
  statusCode?: number;
  cause?: unknown;
}

export class ProviderError extends Error {
  readonly provider: string;
  readonly kind: ProviderErrorKind;
  readonly statusCode?: number;
  override readonly cause?: unknown;

  constructor(options: ProviderErrorOptions) {
    super(options.message);
    this.name = "ProviderError";
    this.provider = options.provider;
    this.kind = options.kind;
    this.statusCode = options.statusCode;
    this.cause = options.cause;
  }
}

export function classifyHttpProviderError(
  provider: string,
  statusCode: number,
  message: string,
): ProviderError {
  if (statusCode === 401 || statusCode === 403) {
    return new ProviderError({ provider, kind: "auth", statusCode, message });
  }
  if (statusCode === 402) {
    return new ProviderError({ provider, kind: "quota", statusCode, message });
  }
  if (statusCode === 429) {
    return new ProviderError({
      provider,
      kind: "rate_limit",
      statusCode,
      message,
    });
  }
  return new ProviderError({
    provider,
    kind: "invalid_response",
    statusCode,
    message,
  });
}
