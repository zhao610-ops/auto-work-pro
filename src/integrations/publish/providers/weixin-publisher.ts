import {
  ContentImageUploader,
  ContentPublisher,
  MassSendDraftRequest,
  PublishArticleRequest,
  PublishResult,
} from "@src/core/ports/content-publisher.ts";
import type { ResolvedTrendPublishConfig } from "@src/utils/config/define-config.ts";
import {
  type ResolvedWeixinPublishAccountConfig,
  resolveWeixinPublishAccount,
} from "@src/utils/config/define-config.ts";
import { SafeImageDownloader } from "@src/utils/image/safe-image-downloader.ts";
import { ProviderError } from "@src/core/errors/provider-error.ts";
import { redactError } from "@src/utils/security/redact.ts";
import {
  WeixinAccessTokenResponse,
  WeixinApiClient,
} from "@src/integrations/publish/providers/weixin-api-client.ts";
import { Logger } from "@zilla/logger";
const logger = new Logger("weixin-publisher");

interface WeixinToken {
  access_token: string;
  expires_in: number;
  expiresAt: Date;
}

interface WeixinDraft {
  media_id: string;
  article_id?: string;
}

interface WeixinPublishSubmitResponse {
  publish_id: string | number;
}

interface WeixinPublishedArticleItem {
  article_url?: string;
}

interface WeixinPublishStatusResponse {
  publish_id?: string | number;
  publish_status: number;
  article_id?: string;
  article_detail?: {
    item?: WeixinPublishedArticleItem[];
  };
}

interface WeixinMassSubmitResponse {
  msg_id: string | number;
  msg_data_id?: string | number;
}

interface WeixinMassStatusResponse {
  msg_id?: string | number;
  msg_status?: string;
}

export interface WeixinPublisherOptions {
  publishStatusPollIntervalMs?: number;
  publishStatusTimeoutMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface WeixinMaterialImageResponse {
  media_id: string;
}

interface WeixinContentImageResponse {
  url: string;
}

function toArrayBuffer(imageBuffer: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (imageBuffer instanceof ArrayBuffer) {
    return imageBuffer;
  }

  const buffer = new ArrayBuffer(imageBuffer.byteLength);
  new Uint8Array(buffer).set(imageBuffer);
  return buffer;
}

export class WeixinPublisher implements ContentPublisher, ContentImageUploader {
  private static readonly COVER_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
  private static readonly CONTENT_IMAGE_MAX_BYTES = 1024 * 1024;
  private accessToken: WeixinToken | null = null;
  private appId: string | undefined;
  private appSecret: string | undefined;
  private readonly publishStatusPollIntervalMs: number;
  private readonly publishStatusTimeoutMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    private readonly configuredProvider?: ResolvedTrendPublishConfig[
      "providers"
    ]["publish"]["weixin"],
    private readonly accountId?: string,
    private readonly apiClient = new WeixinApiClient(),
    private readonly imageDownloader = new SafeImageDownloader(),
    options: WeixinPublisherOptions = {},
  ) {
    this.publishStatusPollIntervalMs = options.publishStatusPollIntervalMs ??
      5000;
    this.publishStatusTimeoutMs = options.publishStatusTimeoutMs ?? 240000;
    this.sleep = options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async refresh(): Promise<void> {
    const provider = this.getProvider();
    this.appId = provider.appId;
    this.appSecret = provider.appSecret;
    logger.debug("微信公众号配置:", {
      appId: maskSecret(this.appId),
      appSecret: maskSecret(this.appSecret),
    });
  }

  private async ensureAccessToken(): Promise<string> {
    // 检查现有token是否有效
    if (
      this.accessToken &&
      this.accessToken.expiresAt > new Date(Date.now() + 60000) // 预留1分钟余量
    ) {
      return this.accessToken.access_token;
    }

    try {
      await this.refresh();
      const response: WeixinAccessTokenResponse = await this.apiClient
        .getAccessToken(
          this.appId ?? "",
          this.appSecret ?? "",
        );
      const { access_token, expires_in } = response;

      if (!access_token) {
        throw new Error(
          "获取access_token失败: " + JSON.stringify(response),
        );
      }

      this.accessToken = {
        access_token,
        expires_in,
        expiresAt: new Date(Date.now() + expires_in * 1000),
      };

      return access_token;
    } catch (error) {
      logger.error("获取微信access_token失败:", redactError(error));
      throw error;
    }
  }

  private async uploadDraft(
    article: string,
    title: string,
    digest: string,
    mediaId: string,
  ): Promise<WeixinDraft> {
    const token = await this.ensureAccessToken();

    const provider = this.getProvider();
    const articles = [
      {
        title: title,
        author: provider.author,
        digest: digest,
        content: article,
        thumb_media_id: mediaId,
        need_open_comment: provider.needOpenComment ? 1 : 0,
        only_fans_can_comment: provider.onlyFansCanComment ? 1 : 0,
      },
    ];
    try {
      const response = await this.apiClient.postJson<WeixinDraft>(
        "/cgi-bin/draft/add",
        token,
        {
          articles,
        },
      );

      return {
        media_id: response.media_id,
      };
    } catch (error) {
      logger.error("上传微信草稿失败:", redactError(error));
      throw error;
    }
  }

  private async submitDraft(mediaId: string): Promise<string> {
    const token = await this.ensureAccessToken();
    const response = await this.apiClient.postJson<WeixinPublishSubmitResponse>(
      "/cgi-bin/freepublish/submit",
      token,
      { media_id: mediaId },
    );
    const publishId = String(response.publish_id ?? "").trim();
    if (!publishId) {
      throw new ProviderError({
        provider: "weixin",
        kind: "invalid_response",
        message: "微信发布接口未返回 publish_id",
      });
    }
    return publishId;
  }

  private async getPublishStatus(
    publishId: string,
  ): Promise<WeixinPublishStatusResponse> {
    const token = await this.ensureAccessToken();
    return await this.apiClient.postJson<WeixinPublishStatusResponse>(
      "/cgi-bin/freepublish/get",
      token,
      { publish_id: publishId },
    );
  }

  private async waitForPublishResult(
    publishId: string,
  ): Promise<WeixinPublishStatusResponse | null> {
    const deadline = Date.now() + this.publishStatusTimeoutMs;
    while (Date.now() < deadline) {
      const status = await this.getPublishStatus(publishId);
      if (status.publish_status === 0) return status;
      if (status.publish_status !== 1) {
        throw new ProviderError({
          provider: "weixin",
          kind: "invalid_response",
          message: describePublishFailure(status.publish_status),
        });
      }
      await this.sleep(this.publishStatusPollIntervalMs);
    }
    return null;
  }

  private async submitMassSend(
    mediaId: string,
    clientMessageId: string,
  ): Promise<{ messageId: string; dataId?: string }> {
    const token = await this.ensureAccessToken();
    const response = await this.apiClient.postJson<WeixinMassSubmitResponse>(
      "/cgi-bin/message/mass/sendall",
      token,
      {
        filter: { is_to_all: true },
        mpnews: { media_id: mediaId },
        msgtype: "mpnews",
        send_ignore_reprint: 0,
        // 微信当前实际校验上限为 32 字节；运行 ID 仅含 ASCII，按 32 个字符截断即可。
        clientmsgid: clientMessageId.slice(0, 32),
      },
    );
    const messageId = String(response.msg_id ?? "").trim();
    if (!messageId) {
      throw new ProviderError({
        provider: "weixin",
        kind: "invalid_response",
        message: "微信群发接口未返回 msg_id",
      });
    }
    const dataId = String(response.msg_data_id ?? "").trim() || undefined;
    return { messageId, dataId };
  }

  private async getMassSendStatus(
    messageId: string,
  ): Promise<WeixinMassStatusResponse> {
    const token = await this.ensureAccessToken();
    return await this.apiClient.postJson<WeixinMassStatusResponse>(
      "/cgi-bin/message/mass/get",
      token,
      { msg_id: messageId },
    );
  }

  private async waitForMassSendResult(
    messageId: string,
  ): Promise<WeixinMassStatusResponse | null> {
    const deadline = Date.now() + this.publishStatusTimeoutMs;
    while (Date.now() < deadline) {
      const status = await this.getMassSendStatus(messageId);
      const value = status.msg_status?.trim().toUpperCase();
      if (value === "SEND_SUCCESS") return status;
      if (value && value !== "SENDING" && value !== "SEND_PENDING") {
        throw new ProviderError({
          provider: "weixin",
          kind: "invalid_response",
          message: `微信群发失败: ${value}`,
        });
      }
      await this.sleep(this.publishStatusPollIntervalMs);
    }
    return null;
  }
  /**
   * 上传图片到微信
   * @param imageUrl 图片URL
   * @returns 图片ID
   */
  async uploadImage(imageUrl: string): Promise<string> {
    if (!imageUrl) {
      // 如果图片URL为空，则返回一个默认的图片ID
      return "SwCSRjrdGJNaWioRQUHzgF68BHFkSlb_f5xlTquvsOSA6Yy0ZRjFo0aW9eS3JJu_";
    }
    const image = await this.imageDownloader.download(imageUrl);
    if (image.bytes.byteLength > WeixinPublisher.COVER_IMAGE_MAX_BYTES) {
      throw new ProviderError({
        provider: "weixin",
        kind: "validation",
        message: "封面图片超过微信素材上传大小限制",
      });
    }

    const token = await this.ensureAccessToken();

    try {
      // 创建FormData并添加图片数据
      const formData = new FormData();
      formData.append(
        "media",
        new Blob([toArrayBuffer(image.bytes)], { type: image.contentType }),
        createImageFilename(image.contentType),
      );

      const response = await this.apiClient.postForm<
        WeixinMaterialImageResponse
      >(
        "/cgi-bin/material/add_material",
        token,
        formData,
        {
          type: "image",
        },
      );

      return response.media_id;
    } catch (error) {
      logger.error("上传微信图片失败:", redactError(error));
      throw error;
    }
  }

  /**
   * 上传图文消息内的图片获取URL
   * @param imageUrl 图片URL
   * @returns 图片URL
   * @description 本接口所上传的图片不占用公众号的素材库中图片数量的限制
   * 图片仅支持jpg/png格式，大小必须在1MB以下
   */
  async uploadContentImage(
    imageUrl: string,
    imageBuffer?: ArrayBuffer | Uint8Array,
  ): Promise<string> {
    if (!imageUrl) {
      throw new Error("图片URL不能为空");
    }

    const token = await this.ensureAccessToken();

    try {
      // 创建FormData并添加图片数据
      const formData = new FormData();

      if (imageBuffer) {
        // 如果提供了压缩后的图片buffer，直接使用
        const bytes = imageBuffer instanceof Uint8Array
          ? imageBuffer
          : new Uint8Array(imageBuffer);
        if (bytes.byteLength > WeixinPublisher.CONTENT_IMAGE_MAX_BYTES) {
          throw new ProviderError({
            provider: "weixin",
            kind: "validation",
            message: "正文图片超过微信图文图片上传大小限制",
          });
        }
        formData.append(
          "media",
          new Blob([toArrayBuffer(bytes)], { type: "image/jpeg" }),
          `image_${Math.random().toString(36).substring(2, 8)}.jpg`,
        );
      } else {
        // 否则下载原图
        const image = await new SafeImageDownloader({
          maxBytes: WeixinPublisher.CONTENT_IMAGE_MAX_BYTES,
        }).download(imageUrl);
        formData.append(
          "media",
          new Blob([toArrayBuffer(image.bytes)], { type: image.contentType }),
          createImageFilename(image.contentType),
        );
      }

      const response = await this.apiClient.postForm<
        WeixinContentImageResponse
      >(
        "/cgi-bin/media/uploadimg",
        token,
        formData,
      );

      return response.url;
    } catch (error) {
      logger.error("上传微信图文消息图片失败:", redactError(error));
      throw error;
    }
  }

  /**
   * 发布文章到微信
   * @param article 文章内容
   * @param title 文章标题
   * @param digest 文章摘要
   * @param mediaId 图片ID
   * @returns 发布结果
   */
  async publishArticle(request: PublishArticleRequest): Promise<PublishResult> {
    try {
      const account = this.getAccount();
      // 上传草稿
      const draft = await this.uploadDraft(
        request.content,
        request.title,
        request.digest,
        request.coverMediaId,
      );
      if ((request.publishMode ?? "draft") === "draft") {
        return {
          publishId: draft.media_id,
          draftMediaId: draft.media_id,
          status: "draft",
          publishedAt: new Date(),
          platform: "weixin",
          accountId: account.accountId,
        };
      }

      if (request.publishMode === "mass") {
        const idempotencyKey = request.idempotencyKey?.trim();
        if (!idempotencyKey) {
          throw new ProviderError({
            provider: "weixin",
            kind: "validation",
            message: "微信群发缺少幂等键 idempotencyKey",
          });
        }
        return await this.massSendDraft({
          draftMediaId: draft.media_id,
          idempotencyKey,
        });
      }

      const publishId = await this.submitDraft(draft.media_id);
      const status = await this.waitForPublishResult(publishId);
      if (!status) {
        return {
          publishId,
          draftMediaId: draft.media_id,
          status: "publishing",
          publishedAt: new Date(),
          platform: "weixin",
          accountId: account.accountId,
          reason: "微信发布任务仍在处理中，可稍后查询发布状态",
        };
      }
      const url = status.article_detail?.item?.find((item) =>
        Boolean(item.article_url)
      )?.article_url;
      return {
        publishId,
        draftMediaId: draft.media_id,
        articleId: status.article_id,
        status: "published",
        publishedAt: new Date(),
        platform: "weixin",
        accountId: account.accountId,
        url,
      };
    } catch (error) {
      logger.error("微信发布失败:", redactError(error));
      throw error;
    }
  }

  async massSendDraft(request: MassSendDraftRequest): Promise<PublishResult> {
    const account = this.getAccount();
    const idempotencyKey = request.idempotencyKey.trim();
    if (!idempotencyKey) {
      throw new ProviderError({
        provider: "weixin",
        kind: "validation",
        message: "微信群发缺少幂等键 idempotencyKey",
      });
    }
    const mass = await this.submitMassSend(
      request.draftMediaId,
      idempotencyKey,
    );
    const status = await this.waitForMassSendResult(mass.messageId);
    return {
      publishId: mass.messageId,
      draftMediaId: request.draftMediaId,
      massMessageId: mass.messageId,
      massDataId: mass.dataId,
      status: status ? "mass-sent" : "mass-sending",
      publishedAt: new Date(),
      platform: "weixin",
      accountId: account.accountId,
      ...(!status
        ? { reason: "微信群发任务仍在处理中，可稍后到公众号后台确认" }
        : {}),
    };
  }

  /**
   * 验证当前服务器IP是否在微信公众号的IP白名单中
   * @returns 返回验证结果，true表示IP在白名单中，false表示不在
   * @throws 当API调用失败时抛出错误（非IP白名单相关的错误）
   */
  async validateIpWhitelist(): Promise<string | boolean> {
    try {
      await this.ensureAccessToken();
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes("40164")) {
        return error.message.match(/invalid ip ([^ ]+)/)?.[1] ?? "未知IP";
      }
      throw error;
    }
  }

  private getAccount(): {
    accountId: string;
    provider: ResolvedWeixinPublishAccountConfig;
  } {
    if (!this.configuredProvider) {
      throw new Error("providers.publish.weixin is not configured");
    }
    const account = resolveWeixinPublishAccount(
      this.configuredProvider,
      this.accountId,
    );
    if (!account) {
      const requested = this.accountId?.trim();
      throw new Error(
        requested
          ? `未找到或未配置微信公众号账号: ${requested}`
          : "未配置默认微信公众号账号；多公众号配置时请设置 publisher.accountId",
      );
    }
    return { accountId: account.accountId, provider: account.account };
  }

  private getProvider(): ResolvedWeixinPublishAccountConfig {
    return this.getAccount().provider;
  }
}

function describePublishFailure(status: number): string {
  const descriptions: Record<number, string> = {
    2: "微信发布失败：原创校验失败",
    3: "微信发布失败：常规发布失败",
    4: "微信发布失败：平台审核未通过",
    5: "微信发布失败：文章已被用户删除",
    6: "微信发布失败：文章被平台封禁",
  };
  return descriptions[status] ?? `微信发布失败：未知状态 ${status}`;
}

function maskSecret(value: string | undefined): string {
  if (!value) return "";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function createImageFilename(contentType: string): string {
  const extension = contentType === "image/png"
    ? "png"
    : contentType === "image/webp"
    ? "webp"
    : contentType === "image/gif"
    ? "gif"
    : "jpg";
  return `image_${crypto.randomUUID().slice(0, 8)}.${extension}`;
}
