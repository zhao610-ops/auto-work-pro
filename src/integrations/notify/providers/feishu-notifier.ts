import { INotifier, Level } from "@src/core/ports/notifier.ts";
import axios from "npm:axios@1.8.3";
import type { ResolvedTrendPublishConfig } from "@src/utils/config/define-config.ts";
import { Logger } from "@zilla/logger";

const logger = new Logger("feishu-notify");

export class FeishuNotifier implements INotifier {
  private webhook?: string;

  constructor(
    private readonly configuredProvider?: ResolvedTrendPublishConfig[
      "providers"
    ]["notify"]["feishu"],
  ) {}

  async refresh(): Promise<void> {
    const startTime = Date.now();
    try {
      const provider = this.configuredProvider ?? { webhookUrl: "" };
      this.webhook = provider.webhookUrl || undefined;
    } catch (error) {
      logger.error("Error refreshing FeishuNotifier configuration:", error);
    }
    logger.debug(
      `FeishuNotifier configuration refresh completed. Webhook set: ${!!this
        .webhook}. Time taken: ${Date.now() - startTime}ms`,
    );
  }

  async notify(
    title: string,
    content: string,
    _options: {
      level?: Level;
      // Feishu specific options can be added here if needed
    } = {},
  ): Promise<boolean> {
    // Refresh configuration before sending, ensures config is up-to-date.
    // Consider if this is too frequent or if errors during refresh should prevent notification.
    await this.refresh();

    if (!this.webhook) {
      logger.warn("Feishu webhook URL not configured, skipping notification.");
      return false;
    }

    const messageContent = title
      ? `${title}
${content}`
      : content;
    const payload = {
      msg_type: "text",
      content: {
        text: messageContent,
      },
    };

    try {
      const response = await axios.post(this.webhook, payload, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "User-Agent": "TrendFinder/1.0.0", // Optional: Custom User-Agent
        },
      });

      // Feishu API typically returns errcode/code 0 for success
      // Adjust based on actual Feishu API response structure
      if (
        response.status === 200 && response.data &&
        (response.data.code === 0 || response.data.errcode === 0 ||
          response.data.StatusCode === 0)
      ) {
        logger.debug("Feishu notification sent successfully.");
        return true;
      }

      logger.error("Feishu notification failed:", response.data);
      return false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Error sending Feishu notification:", message);
      if (hasResponseData(error)) {
        logger.error("Feishu error response data:", error.response.data);
      }
      return false;
    }
  }

  async success(title: string, content: string): Promise<boolean> {
    return this.notify(title, `✅ ${content}`, { level: "active" });
  }

  async error(title: string, content: string): Promise<boolean> {
    // Consider if error messages should @mention anyone by default in Feishu
    return this.notify(title, `❌ ${content}`, { level: "timeSensitive" });
  }

  async warning(title: string, content: string): Promise<boolean> {
    return this.notify(title, `⚠️ ${content}`, { level: "timeSensitive" });
  }

  async info(title: string, content: string): Promise<boolean> {
    return this.notify(title, `ℹ️ ${content}`, { level: "passive" });
  }
}

function hasResponseData(
  error: unknown,
): error is { response: { data: unknown } } {
  return typeof error === "object" && error !== null &&
    "response" in error &&
    typeof (error as { response?: unknown }).response === "object" &&
    (error as { response?: unknown }).response !== null &&
    "data" in (error as { response: { data?: unknown } }).response;
}
