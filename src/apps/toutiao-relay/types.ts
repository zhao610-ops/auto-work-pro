export interface ToutiaoRelayConfig {
  port: number;
  token: string;
  profileDir: string;
  headless: boolean;
  chromeExecutablePath?: string;
  chromeChannel?: string;
  screenshotsDir: string;
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
