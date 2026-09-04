import { INotifier } from "@src/core/ports/notifier.ts";
import { BarkNotifier } from "@src/integrations/notify/providers/bark-notifier.ts";
import { DingdingNotify } from "@src/integrations/notify/providers/dingtalk-notifier.ts";
import { FeishuNotifier } from "@src/integrations/notify/providers/feishu-notifier.ts";
import {
  ArticleNotificationChannel,
  ResolvedTrendPublishConfig,
} from "@src/utils/config/define-config.ts";

type NotifyOptions = Parameters<INotifier["notify"]>[2];

export class NoopNotifier implements INotifier {
  refresh(): Promise<void> {
    return Promise.resolve();
  }

  notify(): Promise<boolean> {
    return Promise.resolve(false);
  }

  success(): Promise<boolean> {
    return Promise.resolve(false);
  }

  error(): Promise<boolean> {
    return Promise.resolve(false);
  }

  warning(): Promise<boolean> {
    return Promise.resolve(false);
  }

  info(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

export class CompositeNotifier implements INotifier {
  constructor(private readonly notifiers: INotifier[]) {}

  async refresh(): Promise<void> {
    await Promise.all(this.notifiers.map((notifier) => notifier.refresh()));
  }

  notify(
    title: string,
    content: string,
    options?: NotifyOptions,
  ): Promise<boolean> {
    return this.dispatch((notifier) =>
      notifier.notify(title, content, options)
    );
  }

  success(title: string, content: string): Promise<boolean> {
    return this.dispatch((notifier) => notifier.success(title, content));
  }

  error(title: string, content: string): Promise<boolean> {
    return this.dispatch((notifier) => notifier.error(title, content));
  }

  warning(title: string, content: string): Promise<boolean> {
    return this.dispatch((notifier) => notifier.warning(title, content));
  }

  info(title: string, content: string): Promise<boolean> {
    return this.dispatch((notifier) => notifier.info(title, content));
  }

  private async dispatch(
    send: (notifier: INotifier) => Promise<boolean>,
  ): Promise<boolean> {
    const results = await Promise.all(this.notifiers.map(send));
    return results.some(Boolean);
  }
}

export function createArticleNotifier(
  config: ResolvedTrendPublishConfig,
): INotifier {
  const channels = dedupeChannels(
    config.features.article.notifications.channels,
  );
  const notifiers = channels.map((channel) => createNotifier(channel, config));

  if (notifiers.length === 0) {
    return new NoopNotifier();
  }
  if (notifiers.length === 1) {
    return notifiers[0];
  }
  return new CompositeNotifier(notifiers);
}

function createNotifier(
  channel: ArticleNotificationChannel,
  config: ResolvedTrendPublishConfig,
): INotifier {
  switch (channel) {
    case "bark":
      return new BarkNotifier(config.providers.notify.bark);
    case "dingtalk":
      return new DingdingNotify(config.providers.notify.dingtalk);
    case "feishu":
      return new FeishuNotifier(config.providers.notify.feishu);
  }
}

function dedupeChannels(
  channels: ArticleNotificationChannel[],
): ArticleNotificationChannel[] {
  return Array.from(new Set(channels));
}
