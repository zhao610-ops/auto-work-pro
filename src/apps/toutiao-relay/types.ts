export interface ToutiaoRelayConfig {
  port: number;
  token: string;
  profileDir: string;
  headless: boolean;
  chromeExecutablePath?: string;
  chromeChannel?: string;
  screenshotsDir: string;
  statePath: string;
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

/** 系统调度到点后调用的正式发布请求；不使用头条页面的原生定时功能。 */
export type ToutiaoPublishRequest = ToutiaoDraftRequest;

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
  /** 头条草稿列表返回的真实 ID；未反查到时不返回。 */
  articleId?: string;
  reconciledAt?: string;
}

export interface ToutiaoPublishResult {
  draftId: string;
  status: "published" | "blocked";
  title: string;
  currentUrl: string;
  idempotencyKey?: string;
  screenshotPath?: string;
  reason?: string;
  errorCode?: "AUTH_EXPIRED";
  contentVerified?: boolean;
  coverUploaded?: boolean;
  /** 发布后由头条作品列表反查得到的真实 ID。 */
  articleId?: string;
  reconciledAt?: string;
}

export type ToutiaoRemoteStatus =
  | "draft"
  | "scheduled"
  | "published"
  | "pending_reconciliation";

/**
 * Relay 本地保存的“业务幂等键 <-> 头条真实文章 ID”映射。
 * 本地文件只保存任务状态，不保存浏览器 Cookie 或正文内容。
 */
export interface ToutiaoArticleRecord {
  idempotencyKey: string;
  title: string;
  articleId?: string;
  status: ToutiaoRemoteStatus;
  currentUrl?: string;
  scheduledFor?: string;
  createdAt: string;
  updatedAt: string;
  reconciledAt: string;
  /** 已通过正文回读校验，恢复任务时不再重复写入正文。 */
  contentVerified?: boolean;
  /** 已将原创封面上传并由页面回填确认。 */
  coverUploaded?: boolean;
}

export interface ToutiaoReconcileRequest {
  idempotencyKey?: string;
  title?: string;
}
