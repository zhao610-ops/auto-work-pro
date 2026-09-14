export interface ToutiaoRelayConfig {
  port: number;
  token: string;
  profileDir: string;
  headless: boolean;
  chromeExecutablePath?: string;
  chromeChannel?: string;
  screenshotsDir: string;
  defaultScheduleTime: string;
}

export interface ToutiaoSessionStatus {
  loggedIn: boolean;
  currentUrl?: string;
  message?: string;
  screenshotPath?: string;
}

export interface ToutiaoDraftRequest {
  title: string;
  contentHtml?: string;
  contentText?: string;
  digest?: string;
  coverImagePath?: string;
  coverImageUrl?: string;
  idempotencyKey?: string;
}

export interface ToutiaoScheduleRequest extends ToutiaoDraftRequest {
  /** ISO 8601 时间；省略时使用 TOUTIAO_DEFAULT_SCHEDULE_TIME 的下一次北京时间。 */
  scheduledAt?: string;
}

export interface ToutiaoDraftResult {
  draftId: string;
  status: "draft" | "blocked";
  title: string;
  currentUrl: string;
  savedAt: string;
  idempotencyKey?: string;
  screenshotPath?: string;
  reason?: string;
  errorCode?: "AUTH_EXPIRED";
  contentVerified?: boolean;
  coverUploaded?: boolean;
}

export interface ToutiaoScheduledResult {
  draftId: string;
  status: "scheduled" | "blocked";
  title: string;
  currentUrl: string;
  scheduledFor?: string;
  idempotencyKey?: string;
  screenshotPath?: string;
  reason?: string;
  errorCode?: "AUTH_EXPIRED";
  contentVerified?: boolean;
  coverUploaded?: boolean;
}
