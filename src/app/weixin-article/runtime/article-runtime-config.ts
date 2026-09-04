import type {
  ArticleBodyImageMode,
  ArticleImageSize,
  ArticleTemplateType,
  ArticleVectorStoreProvider,
  FetchProviderName,
  ResolvedTrendPublishConfig,
} from "@src/utils/config/define-config.ts";
import type { PromptProfileName } from "@src/prompts/prompt-profile.ts";
import type {
  CapabilityProfile,
  JsonObject,
  RuntimeArticleSource,
  RuntimeFeatureProfile,
  RuntimeSchedule,
  WeixinAccountProfile,
} from "@src/core/ports/runtime-config-store.ts";

export const ARTICLE_FEATURE_KEY = "article";
export const DEFAULT_ARTICLE_PROFILE_ID = "article-default";
export const DEFAULT_LLM_CAPABILITY_ID = "cap-llm-default";
export const DEFAULT_COVER_IMAGE_CAPABILITY_ID = "cap-image-cover-default";
export const DEFAULT_BODY_IMAGE_CAPABILITY_ID = "cap-image-body-default";
export const DEFAULT_NOTIFICATION_CAPABILITY_ID = "cap-notification-default";
export const DEFAULT_FETCH_CAPABILITY_ID = "cap-fetch-default";
export const DEFAULT_EMBEDDING_CAPABILITY_ID = "cap-embedding-default";

export interface ArticleFeatureProfileConfig {
  count: number;
  dryRun: boolean;
  renderer: {
    template: ArticleTemplateType;
    promptProfile: PromptProfileName;
    llmProfileId: string;
  };
  publisher: {
    provider: "weixin" | "weixin-relay";
    accountId?: string;
  };
  cover: {
    enabled: boolean;
    imageProfileId: string;
    overrides?: {
      model?: string;
    };
  };
  bodyImages: {
    mode: ArticleBodyImageMode;
    imageProfileId: string;
    overrides?: {
      count?: number;
      size?: ArticleImageSize;
      model?: string;
    };
  };
  deduplication: {
    enabled: boolean;
    embeddingProfileId: string;
    vectorStore: ArticleVectorStoreProvider;
  };
  sourceLimits: {
    maxAgeDays: number;
    maxItemsPerSource: number;
  };
  qualityGate: {
    enabled: boolean;
    minScore: number;
    blockOnHighFactIssue: boolean;
    forcePublish: boolean;
    allowForcePublish: boolean;
    maxRevisionRounds: number;
  };
  notifications: {
    profileId?: string;
  };
}

export interface ArticleRuntimeProfileDetail {
  profile: RuntimeFeatureProfile;
  article: ArticleFeatureProfileConfig;
  sources: RuntimeArticleSource[];
  fetchGroups: Record<string, FetchProviderName[]>;
  schedule: RuntimeSchedule | null;
}

export interface ResolvedArticleRuntimeConfig {
  config: ResolvedTrendPublishConfig;
  profile: RuntimeFeatureProfile;
  article: ArticleFeatureProfileConfig;
  account?: WeixinAccountProfile;
  snapshot: JsonObject;
}

export interface ArticleRuntimeBootstrap {
  capabilities: CapabilityProfile[];
  profile: RuntimeFeatureProfile;
}
