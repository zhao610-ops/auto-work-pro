export interface ContentPublisher {
  // 上传图片到指定平台
  uploadImage(imageUrl: string): Promise<string>;

  // 发布文章到指定平台
  publishArticle(request: PublishArticleRequest): Promise<PublishResult>;

  // 群发已经提前创建好的微信草稿。
  massSendDraft(request: MassSendDraftRequest): Promise<PublishResult>;
}

export interface MassSendDraftRequest {
  draftMediaId: string;
  idempotencyKey: string;
}

export interface ContentImageUploader {
  uploadContentImage(
    imageUrl: string,
    imageBuffer?: ArrayBuffer | Uint8Array,
  ): Promise<string>;
}

export interface PublishArticleRequest {
  content: string;
  title: string;
  digest: string;
  coverMediaId: string;
  /** draft 只保存草稿；publish 公开发布；mass 自动群发给全部粉丝。 */
  publishMode?: "draft" | "publish" | "mass";
  /** 稳定的业务幂等键，群发时作为微信 clientmsgid 使用。 */
  idempotencyKey?: string;
}

export interface PublishResult {
  publishId: string;
  draftMediaId?: string;
  articleId?: string;
  massMessageId?: string;
  massDataId?: string;
  url?: string;
  status: PublishStatus;
  publishedAt: Date;
  platform: string;
  accountId?: string;
  reason?: string;
  scheduledFor?: string;
}

export type PublishStatus =
  | "pending"
  | "published"
  | "failed"
  | "draft"
  | "publishing"
  | "mass-sending"
  | "mass-sent"
  | "mass-failed"
  | "scheduled"
  | "blocked";
