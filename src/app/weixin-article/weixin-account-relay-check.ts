import {
  type WeixinRelayHttpClient,
  WeixinRelayPublisher,
} from "@src/integrations/publish/providers/weixin-relay-publisher.ts";
import type {
  ResolvedTrendPublishConfig,
  ResolvedWeixinPublishAccountConfig,
} from "@src/utils/config/define-config.ts";
import {
  isResolvedWeixinAccountConfigured,
  resolveWeixinPublishAccount,
} from "@src/utils/config/define-config.ts";
import { redactSensitiveText } from "@src/utils/security/redact.ts";

type RelayCheckStatus =
  | "ok"
  | "relay_unconfigured"
  | "account_unconfigured"
  | "ip_not_whitelisted"
  | "failed";

export interface WeixinAccountRelayCheckResult {
  accountId: string;
  ok: boolean;
  status: RelayCheckStatus;
  checkedAt: string;
  relayConfigured: boolean;
  accountConfigured: boolean;
  appIdMasked?: string;
  relayUrl?: string;
  result?: string | boolean;
  message: string;
}

export async function checkWeixinAccountRelay(
  config: ResolvedTrendPublishConfig,
  accountId: string,
  httpClient?: WeixinRelayHttpClient,
): Promise<WeixinAccountRelayCheckResult> {
  const checkedAt = new Date().toISOString();
  const relayConfigured = Boolean(
    config.providers.publish.weixinRelay.url &&
      config.providers.publish.weixinRelay.token,
  );
  const selected = resolveWeixinPublishAccount(
    config.providers.publish.weixin,
    accountId,
  );
  const accountConfigured = isResolvedWeixinAccountConfigured(
    selected?.account,
  );
  const appIdMasked = selected ? maskAppId(selected.account.appId) : undefined;

  if (!relayConfigured) {
    return {
      accountId,
      ok: false,
      status: "relay_unconfigured",
      checkedAt,
      relayConfigured,
      accountConfigured,
      appIdMasked,
      message: "weixin-relay URL 或 token 未配置",
    };
  }

  if (!selected || !accountConfigured) {
    return {
      accountId,
      ok: false,
      status: "account_unconfigured",
      checkedAt,
      relayConfigured,
      accountConfigured,
      appIdMasked,
      relayUrl: sanitizeRelayUrl(config.providers.publish.weixinRelay.url),
      message: "当前公众号账号缺少 appId 或 appSecret",
    };
  }

  try {
    const publisher = new WeixinRelayPublisher(
      config.providers.publish.weixinRelay,
      config.providers.publish.weixin,
      accountId,
      httpClient,
    );
    const result = await publisher.validateIpWhitelist();
    if (result === true) {
      return {
        accountId: selected.accountId,
        ok: true,
        status: "ok",
        checkedAt,
        relayConfigured,
        accountConfigured,
        appIdMasked,
        relayUrl: sanitizeRelayUrl(config.providers.publish.weixinRelay.url),
        result,
        message: "relay 可用，微信凭证有效，当前 relay IP 已通过微信公众号校验",
      };
    }
    return {
      accountId: selected.accountId,
      ok: false,
      status: "ip_not_whitelisted",
      checkedAt,
      relayConfigured,
      accountConfigured,
      appIdMasked,
      relayUrl: sanitizeRelayUrl(config.providers.publish.weixinRelay.url),
      result,
      message: `relay 可用，但微信后台 IP 白名单未包含 ${result}`,
    };
  } catch (error) {
    const message = redactSensitiveText(
      error instanceof Error ? error.message : String(error),
    );
    return {
      accountId,
      ok: false,
      status: "failed",
      checkedAt,
      relayConfigured,
      accountConfigured,
      appIdMasked,
      relayUrl: sanitizeRelayUrl(config.providers.publish.weixinRelay.url),
      message,
    };
  }
}

function sanitizeRelayUrl(value: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value;
  }
}

function maskAppId(
  appId: ResolvedWeixinPublishAccountConfig["appId"],
): string | undefined {
  if (!appId) return undefined;
  if (appId.length <= 8) return `${appId.slice(0, 2)}****`;
  return `${appId.slice(0, 4)}****${appId.slice(-4)}`;
}
