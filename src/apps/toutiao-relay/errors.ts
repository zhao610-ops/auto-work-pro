export const TOUTIAO_RELAY_ERROR_CODES = [
  "AUTH_EXPIRED",
  "CONTENT_INVALID",
  "EDITOR_NOT_FOUND",
  "CONTENT_WRITE_FAILED",
  "CONTENT_READBACK_FAILED",
  "COVER_NOT_FOUND",
  "COVER_UPLOAD_FAILED",
  "DRAFT_SAVE_TIMEOUT",
  "DRAFT_SAVE_FAILED",
  "SCHEDULE_TIME_INVALID",
  "SCHEDULE_WINDOW_INVALID",
  "SCHEDULE_CONTROL_NOT_FOUND",
  "SCHEDULE_CONFIRM_FAILED",
  "BROWSER_LAUNCH_FAILED",
  "UNKNOWN",
] as const;

export type ToutiaoRelayErrorCode = (typeof TOUTIAO_RELAY_ERROR_CODES)[number];

export class ToutiaoRelayError extends Error {
  constructor(
    readonly code: ToutiaoRelayErrorCode,
    message: string,
    readonly details?: Record<string, string>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ToutiaoRelayError";
  }
}

export function toToutiaoRelayError(error: unknown): ToutiaoRelayError {
  if (error instanceof ToutiaoRelayError) return error;
  return new ToutiaoRelayError(
    "UNKNOWN",
    error instanceof Error ? error.message : String(error),
  );
}

export function errorHttpStatus(code: ToutiaoRelayErrorCode): number {
  if (code === "AUTH_EXPIRED") return 401;
  if (code === "CONTENT_INVALID") return 400;
  if (code === "COVER_NOT_FOUND") return 400;
  if (code === "SCHEDULE_TIME_INVALID" || code === "SCHEDULE_WINDOW_INVALID") {
    return 400;
  }
  return 500;
}
