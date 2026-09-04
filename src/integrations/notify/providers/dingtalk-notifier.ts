import { INotifier, Level } from "@src/core/ports/notifier.ts";
import axios from "npm:axios@1.8.3";
import type { ResolvedTrendPublishConfig } from "@src/utils/config/define-config.ts";
import { Logger } from "@zilla/logger";

const logger = new Logger("dingding-notify");

export class DingdingNotify implements INotifier {
  private webhook?: string;

  constructor(
    private readonly configuredProvider?: ResolvedTrendPublishConfig[
      "providers"
    ]["notify"]["dingtalk"],
  ) {}

  async refresh(): Promise<void> {
    const startTime = Date.now();
    const provider = this.configuredProvider ?? { webhook: "" };
    this.webhook = provider.webhook || undefined;
    logger.debug(
      `DingDingNotify 配置刷新完成, 耗时: ${Date.now() - startTime}ms`,
    );
  }

  /**
   * 发送钉钉通知
   * @param title 通知标题
   * @param content 通知内容
   * @param options 通知选项
   */
  async notify(
    title: string,
    content: string,
    options: {
      level?: Level;
      sound?: string;
      icon?: string;
      group?: string;
      url?: string;
      isArchive?: boolean;
    } = {},
  ): Promise<boolean> {
    try {
      await this.refresh();
      if (!this.webhook) {
        logger.warn("DingDing webhook not configured, skipping notification");
        return false;
      }

      // 构建消息内容
      const message = {
        msgtype: "text",
        text: {
          content: `通知：${title}\n${content}${
            options.url ? `\n详情链接：${options.url}` : ""
          }`,
        },
        at: {
          isAtAll: options.level === "timeSensitive", // 紧急消息@所有人
        },
      };

      // 发送通知
      const response = await axios.post(this.webhook, message, {
        headers: {
          "User-Agent": "TrendFinder/1.0.0",
          "Content-Type": "application/json",
          "Accept": "*/*",
          "Connection": "keep-alive",
        },
      });

      logger.debug("DingDing notification response:", response.data);

      if (response.status === 200 && response.data.errcode === 0) {
        return true;
      }

      logger.error("DingDing notification failed:", response.data);
      return false;
    } catch (error) {
      logger.error("Error sending DingDing notification:", error);
      return false;
    }
  }

  /**
   * 发送成功通知
   */
  async success(title: string, content: string): Promise<boolean> {
    return this.notify(title, `✅ ${content}`, {
      level: "active",
      group: "success",
    });
  }

  /**
   * 发送错误通知
   */
  async error(title: string, content: string): Promise<boolean> {
    return this.notify(title, `❌ ${content}`, {
      level: "timeSensitive",
      group: "error",
    });
  }

  /**
   * 发送警告通知
   */
  async warning(title: string, content: string): Promise<boolean> {
    return this.notify(title, `⚠️ ${content}`, {
      level: "timeSensitive",
      group: "warning",
    });
  }

  /**
   * 发送信息通知
   */
  async info(title: string, content: string): Promise<boolean> {
    return this.notify(title, `ℹ️ ${content}`, {
      level: "passive",
      group: "info",
    });
  }
}
