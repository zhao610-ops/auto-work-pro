export interface ContentPublisher {
  // 上传图片到指定平台
  uploadImage(imageUrl: string): Promise<string>;

  // 发布文章到指定平台
  publishArticle(request: PublishArticleRequest): Promise<PublishResult>;
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
}

export interface PublishResult {
  publishId: string;
  url?: string;
  status: PublishStatus;
  publishedAt: Date;
  platform: string;
  accountId?: string;
  reason?: string;
}

export type PublishStatus =
  | "pending"
  | "published"
  | "failed"
  | "draft"
  | "scheduled"
  | "blocked";
