import {
  ARTICLE_FEATURE_KEY,
  type ArticleFeatureProfileConfig,
  ArticleRuntimeProfileDetail,
  DEFAULT_ARTICLE_PROFILE_ID,
  DEFAULT_BODY_IMAGE_CAPABILITY_ID,
  DEFAULT_COVER_IMAGE_CAPABILITY_ID,
  DEFAULT_EMBEDDING_CAPABILITY_ID,
  DEFAULT_FETCH_CAPABILITY_ID,
  DEFAULT_LLM_CAPABILITY_ID,
  DEFAULT_NOTIFICATION_CAPABILITY_ID,
  type ResolvedArticleRuntimeConfig,
} from "@src/app/weixin-article/runtime/article-runtime-config.ts";
import { parseArticleSources } from "@src/features/weixin-article/domain/article-source.ts";
import type {
  ArticleBodyImageMode,
  ArticleImageProvider,
  ArticleImageSize,
  ArticleNotificationChannel,
  ArticleTemplateType,
  FetchProviderName,
  ResolvedTrendPublishConfig,
} from "@src/utils/config/define-config.ts";
import type { PromptProfileName } from "@src/prompts/prompt-profile.ts";
import type {
  CapabilityProfile,
  JsonObject,
  JsonValue,
  RuntimeArticleSource,
  RuntimeArticleSourceInput,
  RuntimeConfigStore,
  WeixinAccountProfile,
} from "@src/core/ports/runtime-config-store.ts";

const DEFAULT_TIMEZONE = "Asia/Shanghai";
const DEFAULT_CRON = "0 3 * * *";
const LEGACY_DASHSCOPE_POSTER_MODEL = "wanx-poster-generation-v1";
const DEFAULT_DASHSCOPE_COVER_MODEL = "qwen-image-2.0-pro";

export async function seedArticleRuntimeConfig(
  store: RuntimeConfigStore,
  baseConfig: ResolvedTrendPublishConfig,
): Promise<void> {
  await store.ensureSchema();
  const existing = await store.getFeatureProfile(ARTICLE_FEATURE_KEY);
  if (existing) {
    await seedWeixinAccountProfiles(store, baseConfig);
    await migrateLegacyArticleRuntimeConfig(store);
    return;
  }

  const article = baseConfig.features.article;
  const capabilities: CapabilityProfile[] = [
    {
      id: DEFAULT_LLM_CAPABILITY_ID,
      kind: "llm",
      name: "默认大模型",
      enabled: true,
      provider: "openai-compatible",
      config: compactObject({ model: baseConfig.providers.ai.model }),
      version: 1,
      isDefault: true,
      createdAt: "",
      updatedAt: "",
    },
    {
      id: DEFAULT_COVER_IMAGE_CAPABILITY_ID,
      kind: "image-generation",
      name: "微信封面图",
      enabled: article.cover.enabled,
      provider: article.cover.provider,
      config: compactObject({ model: article.cover.model }),
      version: 1,
      isDefault: true,
      createdAt: "",
      updatedAt: "",
    },
    {
      id: DEFAULT_BODY_IMAGE_CAPABILITY_ID,
      kind: "image-generation",
      name: "正文配图",
      enabled: article.bodyImages.mode !== "off",
      provider: article.bodyImages.provider,
      config: compactObject({
        model: article.bodyImages.model,
        count: article.bodyImages.count,
        size: article.bodyImages.size,
      }),
      version: 1,
      isDefault: false,
      createdAt: "",
      updatedAt: "",
    },
    {
      id: DEFAULT_NOTIFICATION_CAPABILITY_ID,
      kind: "notification",
      name: "运行通知",
      enabled: article.notifications.channels.length > 0,
      provider: "multi-channel",
      config: { channels: article.notifications.channels },
      version: 1,
      isDefault: true,
      createdAt: "",
      updatedAt: "",
    },
    {
      id: DEFAULT_FETCH_CAPABILITY_ID,
      kind: "fetch-strategy",
      name: "默认抓取策略",
      enabled: true,
      provider: "configured-fetch-groups",
      config: { groups: normalizeFetchGroups(baseConfig.fetchGroups) },
      version: 1,
      isDefault: true,
      createdAt: "",
      updatedAt: "",
    },
    {
      id: DEFAULT_EMBEDDING_CAPABILITY_ID,
      kind: "embedding",
      name: "文章去重 Embedding",
      enabled: article.deduplication.enabled,
      provider: article.deduplication.embeddingProvider,
      config: compactObject({
        model: baseConfig.providers.vector.embedding.model,
      }),
      version: 1,
      isDefault: true,
      createdAt: "",
      updatedAt: "",
    },
  ];

  for (const capability of capabilities) {
    await store.saveCapabilityProfile(capability);
  }

  const profile = await store.saveFeatureProfile({
    id: DEFAULT_ARTICLE_PROFILE_ID,
    featureKey: ARTICLE_FEATURE_KEY,
    name: "默认微信文章",
    enabled: true,
    isDefault: true,
    version: 1,
    config: articleConfigToJson(defaultArticleProfileConfig(baseConfig)),
    createdAt: "",
    updatedAt: "",
  });

  await store.replaceArticleSources(
    profile.id,
    parseSourcesForRuntime(article.sources),
  );
  await store.replaceArticleFetchGroups(
    profile.id,
    normalizeFetchGroups(baseConfig.fetchGroups),
  );
  await store.saveSchedule({
    featureKey: ARTICLE_FEATURE_KEY,
    profileId: profile.id,
    name: "默认微信文章定时",
    enabled: true,
    cron: DEFAULT_CRON,
    timezone: DEFAULT_TIMEZONE,
    dryRun: article.dryRun,
  });
  await seedWeixinAccountProfiles(store, baseConfig);
  await migrateLegacyArticleRuntimeConfig(store);
}

async function seedWeixinAccountProfiles(
  store: RuntimeConfigStore,
  baseConfig: ResolvedTrendPublishConfig,
): Promise<void> {
  const existing = await store.listWeixinAccountProfiles();
  if (existing.length > 0) return;

  const accountIds = Object.keys(baseConfig.providers.publish.weixin.accounts);
  const hasDefault = Boolean(
    baseConfig.providers.publish.weixin.appId &&
      baseConfig.providers.publish.weixin.appSecret,
  );
  const ids = hasDefault ? ["default", ...accountIds] : accountIds;
  for (const id of ids) {
    await store.saveWeixinAccountProfile(defaultWeixinAccountProfile(id));
  }
}

function defaultWeixinAccountProfile(id: string): Omit<
  WeixinAccountProfile,
  "createdAt" | "updatedAt"
> {
  const displayName = id === "default" ? "默认公众号" : id;
  return {
    id,
    name: displayName,
    enabled: true,
    defaultArticleProfileId: DEFAULT_ARTICLE_PROFILE_ID,
    brand: {
      displayName,
      positioning: "围绕 AI 趋势生产高质量微信文章",
      audience: "关注 AI 产品、技术和行业趋势的读者",
      tone: "专业、克制、清晰，减少 AI 味和空话",
      titleStyle: "有信息钩子，但不标题党",
      forbiddenTopics: [],
    },
    defaults: {
      articleProfileId: DEFAULT_ARTICLE_PROFILE_ID,
    },
    ops: {},
  };
}

async function migrateLegacyArticleRuntimeConfig(
  store: RuntimeConfigStore,
): Promise<void> {
  const coverCapability = await store.getCapabilityProfile(
    DEFAULT_COVER_IMAGE_CAPABILITY_ID,
  );
  if (
    coverCapability?.provider === "dashscope" &&
    stringValue(coverCapability.config.model) === LEGACY_DASHSCOPE_POSTER_MODEL
  ) {
    await store.saveCapabilityProfile({
      ...coverCapability,
      config: {
        ...coverCapability.config,
        model: DEFAULT_DASHSCOPE_COVER_MODEL,
      },
    });
  }

  const profiles = await store.listFeatureProfiles(ARTICLE_FEATURE_KEY);
  for (const profile of profiles) {
    const cover = objectValue(profile.config.cover);
    const overrides = objectValue(cover.overrides);
    if (
      stringValue(cover.imageProfileId) === DEFAULT_COVER_IMAGE_CAPABILITY_ID &&
      stringValue(overrides.model) === LEGACY_DASHSCOPE_POSTER_MODEL
    ) {
      await store.saveFeatureProfile({
        ...profile,
        config: deepMerge(profile.config, {
          cover: {
            overrides: {
              model: DEFAULT_DASHSCOPE_COVER_MODEL,
            },
          },
        }),
      });
    }
  }
}

export async function listArticleRuntimeProfiles(
  store: RuntimeConfigStore,
  baseConfig: ResolvedTrendPublishConfig,
): Promise<ArticleRuntimeProfileDetail[]> {
  await seedArticleRuntimeConfig(store, baseConfig);
  const profiles = await store.listFeatureProfiles(ARTICLE_FEATURE_KEY);
  return await Promise.all(
    profiles.map((profile) =>
      getArticleRuntimeProfileDetail(
        store,
        baseConfig,
        profile.id,
      )
    ),
  );
}

export async function getArticleRuntimeProfileDetail(
  store: RuntimeConfigStore,
  baseConfig: ResolvedTrendPublishConfig,
  profileId?: string,
): Promise<ArticleRuntimeProfileDetail> {
  await seedArticleRuntimeConfig(store, baseConfig);
  const profile = await store.getFeatureProfile(ARTICLE_FEATURE_KEY, profileId);
  if (!profile) {
    throw new Error(`微信文章 Profile 不存在: ${profileId ?? "default"}`);
  }
  const fetchGroups = await getFetchGroups(store, profile.id, baseConfig);
  return {
    profile,
    article: readArticleConfig(profile.config, baseConfig),
    sources: await getArticleSources(store, profile.id, baseConfig),
    fetchGroups,
    schedule: await store.getSchedule(profile.id),
  };
}

export async function resolveArticleRuntimeConfig(
  store: RuntimeConfigStore,
  baseConfig: ResolvedTrendPublishConfig,
  profileId?: string,
  accountId?: string,
): Promise<ResolvedArticleRuntimeConfig> {
  await seedArticleRuntimeConfig(store, baseConfig);
  const inputAccount = accountId
    ? await store.getWeixinAccountProfile(accountId)
    : null;
  if (accountId && !inputAccount) {
    throw new Error(`微信公众号运营账号不存在: ${accountId}`);
  }
  if (inputAccount && !inputAccount.enabled) {
    throw new Error(`微信公众号运营账号已禁用: ${inputAccount.name}`);
  }
  const effectiveProfileId = profileId ??
    inputAccount?.defaultArticleProfileId ??
    stringValue(inputAccount?.defaults.articleProfileId) ??
    undefined;
  const detail = await getArticleRuntimeProfileDetail(
    store,
    baseConfig,
    effectiveProfileId,
  );
  if (!detail.profile.enabled) {
    throw new Error(`微信文章 Profile 已禁用: ${detail.profile.name}`);
  }

  const next = cloneConfig(baseConfig);
  const profileAccountId = accountId ?? detail.article.publisher.accountId;
  const account = inputAccount ??
    (profileAccountId
      ? await store.getWeixinAccountProfile(profileAccountId)
      : null);
  if (profileAccountId && !account) {
    throw new Error(`微信公众号运营账号不存在: ${profileAccountId}`);
  }
  if (account && !account.enabled) {
    throw new Error(`微信公众号运营账号已禁用: ${account.name}`);
  }
  const article = applyAccountDefaults(
    detail.article,
    account,
    profileAccountId,
  );
  const llm = await requireCapability(store, article.renderer.llmProfileId);
  const coverImage = await requireCapability(
    store,
    article.cover.imageProfileId,
  );
  const bodyImage = await requireCapability(
    store,
    article.bodyImages.imageProfileId,
  );
  const embedding = await requireCapability(
    store,
    article.deduplication.embeddingProfileId,
  );
  const notification = article.notifications.profileId
    ? await requireCapability(store, article.notifications.profileId)
    : null;
  const selectedSources = applyAccountSourceGroups(detail.sources, account);

  next.fetchGroups = detail.fetchGroups;
  next.features.article.sources = selectedSources
    .filter((source) => source.enabled)
    .sort((a, b) => a.position - b.position)
    .map((source) => source.raw);
  next.features.article.count = article.count;
  next.features.article.dryRun = article.dryRun;
  next.features.article.renderer = {
    template: article.renderer.template,
    promptProfile: article.renderer.promptProfile,
  };
  next.features.article.publisher = {
    provider: article.publisher.provider,
    accountId: article.publisher.accountId ?? "",
  };

  const llmModel = stringValue(llm.config.model);
  if (llmModel) next.providers.ai.model = llmModel;
  if (llm.provider !== "openai-compatible") {
    throw new Error(`暂不支持的 LLM 能力 provider: ${llm.provider}`);
  }
  if (!isArticleImageProvider(coverImage.provider)) {
    throw new Error(`暂不支持的图片生成能力 provider: ${coverImage.provider}`);
  }
  if (!isArticleImageProvider(bodyImage.provider)) {
    throw new Error(`暂不支持的图片生成能力 provider: ${bodyImage.provider}`);
  }
  if (embedding.provider !== "dashscope") {
    throw new Error(
      `暂不支持的 Embedding 能力 provider: ${embedding.provider}`,
    );
  }

  next.features.article.cover = {
    enabled: article.cover.enabled && coverImage.enabled,
    provider: coverImage.provider,
    model: resolveImageModel(coverImage.provider, "cover", [
      article.cover.overrides?.model,
      stringValue(coverImage.config.model),
      next.features.article.cover.model,
    ]),
  };

  next.features.article.bodyImages = {
    mode: bodyImage.enabled ? article.bodyImages.mode : "off",
    provider: bodyImage.provider,
    model: resolveImageModel(bodyImage.provider, "body", [
      article.bodyImages.overrides?.model,
      stringValue(bodyImage.config.model),
      next.features.article.bodyImages.model,
    ]),
    count: article.bodyImages.overrides?.count ??
      numberValue(bodyImage.config.count) ??
      next.features.article.bodyImages.count,
    size: article.bodyImages.overrides?.size ??
      stringValue(bodyImage.config.size) as ArticleImageSize ??
      next.features.article.bodyImages.size,
  };

  next.features.article.deduplication = {
    enabled: article.deduplication.enabled && embedding.enabled,
    embeddingProvider: "dashscope",
    vectorStore: article.deduplication.vectorStore,
  };
  next.features.article.sourceLimits = {
    ...article.sourceLimits,
  };
  next.features.article.qualityGate = {
    ...article.qualityGate,
  };
  const embeddingModel = stringValue(embedding.config.model);
  if (embeddingModel) next.providers.vector.embedding.model = embeddingModel;

  next.features.article.notifications = {
    channels: notification?.enabled
      ? readNotificationChannels(notification.config.channels)
      : [],
  };

  return {
    config: next,
    profile: detail.profile,
    article,
    account: account ?? undefined,
    snapshot: createRuntimeConfigSnapshot(
      detail,
      {
        llm,
        coverImage,
        bodyImage,
        embedding,
        notification,
      },
      article,
      account ?? undefined,
      selectedSources,
    ),
  };
}

function applyAccountDefaults(
  article: ArticleFeatureProfileConfig,
  account: WeixinAccountProfile | null,
  inputAccountId?: string,
): ArticleFeatureProfileConfig {
  const next = structuredClone(article);
  const accountId = inputAccountId ?? account?.id;
  if (accountId) next.publisher.accountId = accountId;
  if (!account?.enabled) return next;

  const promptProfile = stringValue(account.defaults.promptProfile);
  if (promptProfile) {
    next.renderer.promptProfile = promptProfile as PromptProfileName;
  }
  const template = stringValue(account.defaults.template);
  if (template) {
    next.renderer.template = readTemplate(template, next.renderer.template);
  }
  const count = numberValue(account.defaults.count);
  if (count) next.count = Math.min(Math.max(Math.floor(count), 1), 50);
  return next;
}

function applyAccountSourceGroups(
  sources: RuntimeArticleSource[],
  account: WeixinAccountProfile | null,
): RuntimeArticleSource[] {
  const groups = readSourceGroupIds(account?.defaults.sourceGroupIds);
  if (groups.length === 0) return sources;

  const selected = sources.filter((source) => groups.includes(source.group));
  if (selected.some((source) => source.enabled)) return selected;

  throw new Error(
    `账号 ${
      account?.name ?? account?.id ?? "default"
    } 的数据源分组没有可用来源: ${groups.join(", ")}`,
  );
}

function readSourceGroupIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((item): item is string => typeof item === "string").map((
        item,
      ) => item.trim()).filter(Boolean),
    ),
  ];
}

export async function saveArticleProfileConfig(
  store: RuntimeConfigStore,
  baseConfig: ResolvedTrendPublishConfig,
  profileId: string,
  patch: Partial<ArticleFeatureProfileConfig> & JsonObject,
): Promise<ArticleRuntimeProfileDetail> {
  const detail = await getArticleRuntimeProfileDetail(
    store,
    baseConfig,
    profileId,
  );
  const nextArticle = mergeArticleConfig(detail.article, patch);
  await store.saveFeatureProfile({
    ...detail.profile,
    config: articleConfigToJson(nextArticle),
  });
  return await getArticleRuntimeProfileDetail(store, baseConfig, profileId);
}

export async function createArticleRuntimeProfile(
  store: RuntimeConfigStore,
  baseConfig: ResolvedTrendPublishConfig,
  input: { name?: string; copyFromProfileId?: string } = {},
): Promise<ArticleRuntimeProfileDetail> {
  const source = await getArticleRuntimeProfileDetail(
    store,
    baseConfig,
    input.copyFromProfileId,
  );
  const profile = await store.saveFeatureProfile({
    id: `article-${crypto.randomUUID()}`,
    featureKey: ARTICLE_FEATURE_KEY,
    name: input.name?.trim() || `${source.profile.name} 副本`,
    enabled: true,
    isDefault: false,
    version: source.profile.version,
    config: source.profile.config,
  });
  await store.replaceArticleSources(
    profile.id,
    source.sources.map((item) => ({
      raw: item.raw,
      url: item.url,
      group: item.group,
      enabled: item.enabled,
      position: item.position,
    })),
  );
  await store.replaceArticleFetchGroups(profile.id, source.fetchGroups);
  if (source.schedule) {
    await store.saveSchedule({
      featureKey: ARTICLE_FEATURE_KEY,
      profileId: profile.id,
      name: `${profile.name} 定时`,
      enabled: source.schedule.enabled,
      cron: source.schedule.cron,
      timezone: source.schedule.timezone,
      dryRun: source.schedule.dryRun,
    });
  }
  return await getArticleRuntimeProfileDetail(store, baseConfig, profile.id);
}

export function defaultArticleProfileConfig(
  baseConfig: ResolvedTrendPublishConfig,
): ArticleFeatureProfileConfig {
  const article = baseConfig.features.article;
  return {
    count: article.count,
    dryRun: article.dryRun,
    renderer: {
      template: article.renderer.template,
      promptProfile: article.renderer.promptProfile,
      llmProfileId: DEFAULT_LLM_CAPABILITY_ID,
    },
    publisher: {
      provider: article.publisher.provider,
      accountId: article.publisher.accountId,
    },
    cover: {
      enabled: article.cover.enabled,
      imageProfileId: DEFAULT_COVER_IMAGE_CAPABILITY_ID,
      overrides: {
        model: article.cover.model,
      },
    },
    bodyImages: {
      mode: article.bodyImages.mode,
      imageProfileId: DEFAULT_BODY_IMAGE_CAPABILITY_ID,
      overrides: {
        model: article.bodyImages.model,
        count: article.bodyImages.count,
        size: article.bodyImages.size,
      },
    },
    deduplication: {
      enabled: article.deduplication.enabled,
      embeddingProfileId: DEFAULT_EMBEDDING_CAPABILITY_ID,
      vectorStore: article.deduplication.vectorStore,
    },
    sourceLimits: {
      maxAgeDays: article.sourceLimits.maxAgeDays,
      maxItemsPerSource: article.sourceLimits.maxItemsPerSource,
    },
    qualityGate: {
      enabled: article.qualityGate.enabled,
      minScore: article.qualityGate.minScore,
      blockOnHighFactIssue: article.qualityGate.blockOnHighFactIssue,
      forcePublish: article.qualityGate.forcePublish,
      allowForcePublish: article.qualityGate.allowForcePublish,
      maxRevisionRounds: article.qualityGate.maxRevisionRounds,
    },
    notifications: {
      profileId: DEFAULT_NOTIFICATION_CAPABILITY_ID,
    },
  };
}

export function readArticleConfig(
  value: JsonObject,
  baseConfig: ResolvedTrendPublishConfig,
): ArticleFeatureProfileConfig {
  const fallback = defaultArticleProfileConfig(baseConfig);
  const renderer = objectValue(value.renderer);
  const publisher = objectValue(value.publisher);
  const cover = objectValue(value.cover);
  const coverOverrides = objectValue(cover.overrides);
  const bodyImages = objectValue(value.bodyImages);
  const bodyOverrides = objectValue(bodyImages.overrides);
  const deduplication = objectValue(value.deduplication);
  const sourceLimits = objectValue(value.sourceLimits);
  const qualityGate = objectValue(value.qualityGate);
  const notifications = objectValue(value.notifications);
  return {
    count: numberValue(value.count) ?? fallback.count,
    dryRun: booleanValue(value.dryRun) ?? fallback.dryRun,
    renderer: {
      template: readTemplate(renderer.template, fallback.renderer.template),
      promptProfile: (stringValue(renderer.promptProfile) ??
        fallback.renderer.promptProfile) as PromptProfileName,
      llmProfileId: stringValue(renderer.llmProfileId) ??
        fallback.renderer.llmProfileId,
    },
    publisher: {
      provider: readPublisher(publisher.provider, fallback.publisher.provider),
      accountId: stringValue(publisher.accountId) ??
        fallback.publisher.accountId,
    },
    cover: {
      enabled: booleanValue(cover.enabled) ?? fallback.cover.enabled,
      imageProfileId: stringValue(cover.imageProfileId) ??
        fallback.cover.imageProfileId,
      overrides: {
        model: stringValue(coverOverrides.model) ??
          fallback.cover.overrides?.model,
      },
    },
    bodyImages: {
      mode: readBodyImageMode(bodyImages.mode, fallback.bodyImages.mode),
      imageProfileId: stringValue(bodyImages.imageProfileId) ??
        fallback.bodyImages.imageProfileId,
      overrides: {
        model: stringValue(bodyOverrides.model) ??
          fallback.bodyImages.overrides?.model,
        count: numberValue(bodyOverrides.count) ??
          fallback.bodyImages.overrides?.count,
        size: (stringValue(bodyOverrides.size) ??
          fallback.bodyImages.overrides?.size) as ArticleImageSize,
      },
    },
    deduplication: {
      enabled: booleanValue(deduplication.enabled) ??
        fallback.deduplication.enabled,
      embeddingProfileId: stringValue(deduplication.embeddingProfileId) ??
        fallback.deduplication.embeddingProfileId,
      vectorStore: readVectorStore(
        deduplication.vectorStore,
        fallback.deduplication.vectorStore,
      ),
    },
    sourceLimits: {
      maxAgeDays: normalizeInteger(
        sourceLimits.maxAgeDays,
        fallback.sourceLimits.maxAgeDays,
        1,
        365,
      ),
      maxItemsPerSource: normalizeInteger(
        sourceLimits.maxItemsPerSource,
        fallback.sourceLimits.maxItemsPerSource,
        1,
        200,
      ),
    },
    qualityGate: {
      enabled: booleanValue(qualityGate.enabled) ??
        fallback.qualityGate.enabled,
      minScore: numberValue(qualityGate.minScore) ??
        fallback.qualityGate.minScore,
      blockOnHighFactIssue: booleanValue(qualityGate.blockOnHighFactIssue) ??
        fallback.qualityGate.blockOnHighFactIssue,
      forcePublish: booleanValue(qualityGate.forcePublish) ??
        fallback.qualityGate.forcePublish,
      allowForcePublish: booleanValue(qualityGate.allowForcePublish) ??
        fallback.qualityGate.allowForcePublish,
      maxRevisionRounds: numberValue(qualityGate.maxRevisionRounds) ??
        fallback.qualityGate.maxRevisionRounds,
    },
    notifications: {
      profileId: stringValue(notifications.profileId) ??
        fallback.notifications.profileId,
    },
  };
}

export function articleConfigToJson(
  config: ArticleFeatureProfileConfig,
): JsonObject {
  return config as unknown as JsonObject;
}

export function normalizeFetchGroups(
  groups: Record<string, FetchProviderName[]>,
): Record<string, FetchProviderName[]> {
  return Object.fromEntries(
    Object.entries(groups).map(([name, providers]) => [
      name,
      [...new Set(providers)],
    ]),
  );
}

export function parseSourcesForRuntime(
  sources: string[],
): RuntimeArticleSourceInput[] {
  return parseArticleSources(sources).map((source, index) => ({
    raw: source.raw,
    url: source.url,
    group: source.group,
    enabled: true,
    position: index,
  }));
}

function mergeArticleConfig(
  current: ArticleFeatureProfileConfig,
  patch: Partial<ArticleFeatureProfileConfig> & JsonObject,
): ArticleFeatureProfileConfig {
  return readArticleConfig(deepMerge(articleConfigToJson(current), patch), {
    features: { article: articleConfigToResolvedFallback(current) },
  } as ResolvedTrendPublishConfig);
}

function articleConfigToResolvedFallback(
  config: ArticleFeatureProfileConfig,
): ResolvedTrendPublishConfig["features"]["article"] {
  return {
    sources: [],
    renderer: {
      template: config.renderer.template,
      promptProfile: config.renderer.promptProfile,
    },
    publisher: {
      provider: config.publisher.provider,
      accountId: config.publisher.accountId,
    },
    count: config.count,
    dryRun: config.dryRun,
    notifications: { channels: [] },
    cover: {
      enabled: config.cover.enabled,
      provider: "dashscope",
      model: config.cover.overrides?.model ?? "",
    },
    bodyImages: {
      mode: config.bodyImages.mode,
      provider: "dashscope",
      model: config.bodyImages.overrides?.model ?? "",
      count: config.bodyImages.overrides?.count ?? 1,
      size: config.bodyImages.overrides?.size ?? "1024*1024",
    },
    deduplication: {
      enabled: config.deduplication.enabled,
      embeddingProvider: "dashscope",
      vectorStore: config.deduplication.vectorStore,
    },
    sourceLimits: {
      maxAgeDays: config.sourceLimits.maxAgeDays,
      maxItemsPerSource: config.sourceLimits.maxItemsPerSource,
    },
    qualityGate: {
      enabled: config.qualityGate.enabled,
      minScore: config.qualityGate.minScore,
      blockOnHighFactIssue: config.qualityGate.blockOnHighFactIssue,
      forcePublish: config.qualityGate.forcePublish,
      allowForcePublish: config.qualityGate.allowForcePublish,
      maxRevisionRounds: config.qualityGate.maxRevisionRounds,
    },
  };
}

async function getFetchGroups(
  store: RuntimeConfigStore,
  profileId: string,
  baseConfig: ResolvedTrendPublishConfig,
): Promise<Record<string, FetchProviderName[]>> {
  const groups = await store.getArticleFetchGroups(profileId);
  const runtimeGroups = Object.fromEntries(
    Object.entries(groups).map(([name, providers]) => [
      name,
      providers as FetchProviderName[],
    ]),
  );
  return mergeFetchGroups(baseConfig.fetchGroups, runtimeGroups);
}

function mergeFetchGroups(
  baseGroups: Record<string, FetchProviderName[]>,
  runtimeGroups: Record<string, FetchProviderName[]>,
): Record<string, FetchProviderName[]> {
  const normalizedBase = normalizeFetchGroups(baseGroups);
  const normalizedRuntime = normalizeFetchGroups(runtimeGroups);
  const names = new Set([
    ...Object.keys(normalizedBase),
    ...Object.keys(normalizedRuntime),
  ]);

  const merged: Record<string, FetchProviderName[]> = {};
  for (const name of names) {
    const runtimeProviders = normalizedRuntime[name] ?? [];
    const baseProviders = normalizedBase[name] ?? [];
    merged[name] = [
      ...runtimeProviders,
      ...baseProviders.filter((provider) =>
        !runtimeProviders.includes(provider)
      ),
    ];
  }
  return normalizeFetchGroups(merged);
}

async function getArticleSources(
  store: RuntimeConfigStore,
  profileId: string,
  baseConfig: ResolvedTrendPublishConfig,
): Promise<RuntimeArticleSource[]> {
  const runtimeSources = await store.listArticleSources(profileId);
  const runtimeKeys = new Set(runtimeSources.map(sourceKey));
  const maxPosition = runtimeSources.reduce(
    (max, source) => Math.max(max, source.position),
    -1,
  );
  const configSources = parseSourcesForRuntime(
    baseConfig.features.article.sources,
  )
    .filter((source) => !runtimeKeys.has(sourceKey(source)))
    .map((source, index): RuntimeArticleSource => ({
      id: `config:${profileId}:${index}`,
      profileId,
      raw: source.raw,
      url: source.url,
      group: source.group,
      enabled: source.enabled ?? true,
      position: maxPosition + index + 1,
      createdAt: "",
      updatedAt: "",
    }));

  return [...runtimeSources, ...configSources].toSorted((a, b) =>
    a.position - b.position
  );
}

function sourceKey(source: {
  group: string;
  url: string;
}): string {
  return `${source.group}:${source.url}`;
}

async function requireCapability(
  store: RuntimeConfigStore,
  id: string,
): Promise<CapabilityProfile> {
  const profile = await store.getCapabilityProfile(id);
  if (!profile) {
    throw new Error(`能力 Profile 不存在: ${id}`);
  }
  return profile;
}

function createRuntimeConfigSnapshot(
  detail: ArticleRuntimeProfileDetail,
  capabilities: {
    llm: CapabilityProfile;
    coverImage: CapabilityProfile;
    bodyImage: CapabilityProfile;
    embedding: CapabilityProfile;
    notification: CapabilityProfile | null;
  },
  article: ArticleFeatureProfileConfig = detail.article,
  account?: WeixinAccountProfile,
  selectedSources: RuntimeArticleSource[] = detail.sources,
): JsonObject {
  return {
    feature: ARTICLE_FEATURE_KEY,
    profile: {
      id: detail.profile.id,
      name: detail.profile.name,
      enabled: detail.profile.enabled,
      version: detail.profile.version,
    },
    article: articleConfigToJson(article),
    account: account
      ? {
        id: account.id,
        name: account.name,
        enabled: account.enabled,
        defaultArticleProfileId: account.defaultArticleProfileId,
        brand: account.brand,
        defaults: account.defaults,
        ops: account.ops,
      }
      : null,
    sources: selectedSources
      .filter((source) => source.enabled)
      .map((source) => ({
        raw: source.raw,
        group: source.group,
      })),
    fetchGroups: detail.fetchGroups,
    schedule: detail.schedule
      ? {
        enabled: detail.schedule.enabled,
        cron: detail.schedule.cron,
        timezone: detail.schedule.timezone,
        dryRun: detail.schedule.dryRun,
      }
      : null,
    capabilities: {
      llm: publicCapability(capabilities.llm),
      coverImage: publicCapability(capabilities.coverImage),
      bodyImage: publicCapability(capabilities.bodyImage),
      embedding: publicCapability(capabilities.embedding),
      notification: capabilities.notification
        ? publicCapability(capabilities.notification)
        : null,
    },
  };
}

function publicCapability(profile: CapabilityProfile): JsonObject {
  return {
    id: profile.id,
    kind: profile.kind,
    name: profile.name,
    enabled: profile.enabled,
    provider: profile.provider,
    config: profile.config,
  };
}

function cloneConfig(
  config: ResolvedTrendPublishConfig,
): ResolvedTrendPublishConfig {
  return structuredClone(config);
}

function compactObject(
  values: Record<string, JsonValue | undefined>,
): JsonObject {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as JsonObject;
}

function deepMerge(base: JsonObject, patch: JsonObject): JsonObject {
  const next: JsonObject = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const existing = next[key];
    next[key] = isPlainObject(existing) && isPlainObject(value)
      ? deepMerge(existing, value)
      : value;
  }
  return next;
}

function isPlainObject(value: JsonValue | undefined): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function objectValue(value: JsonValue | undefined): JsonObject {
  return isPlainObject(value) ? value : {};
}

function stringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function normalizeInteger(
  value: JsonValue | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const number = numberValue(value);
  if (number === undefined) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(number), min), max);
}

function booleanValue(value: JsonValue | undefined): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readStringArray(value: JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readNotificationChannels(
  value: JsonValue | undefined,
): ArticleNotificationChannel[] {
  return readStringArray(value).filter((
    item,
  ): item is ArticleNotificationChannel =>
    item === "bark" || item === "dingtalk" || item === "feishu"
  );
}

function readTemplate(
  value: JsonValue | undefined,
  fallback: ArticleTemplateType,
): ArticleTemplateType {
  const text = stringValue(value);
  const allowed: ArticleTemplateType[] = [
    "default",
    "minimal",
    "modern",
    "tech",
    "mianpro",
    "longform",
    "product",
    "darktech",
    "dynamic",
    "random",
  ];
  return text && allowed.includes(text as ArticleTemplateType)
    ? text as ArticleTemplateType
    : fallback;
}

function readPublisher(
  value: JsonValue | undefined,
  fallback: "weixin" | "weixin-relay",
) {
  const text = stringValue(value);
  return text === "weixin" || text === "weixin-relay" ? text : fallback;
}

function isArticleImageProvider(value: string): value is ArticleImageProvider {
  return value === "dashscope" || value === "minimax";
}

function defaultImageModel(
  provider: ArticleImageProvider,
  usage: "cover" | "body",
): string {
  switch (provider) {
    case "dashscope":
      return usage === "cover" ? "qwen-image-2.0-pro" : "qwen-image-2.0";
    case "minimax":
      return "image-01";
  }
}

function resolveImageModel(
  provider: ArticleImageProvider,
  usage: "cover" | "body",
  candidates: Array<string | undefined>,
): string {
  for (const candidate of candidates) {
    if (candidate && isCompatibleImageModel(provider, candidate)) {
      return candidate;
    }
  }
  return defaultImageModel(provider, usage);
}

function isCompatibleImageModel(
  provider: ArticleImageProvider,
  model: string,
): boolean {
  switch (provider) {
    case "dashscope":
      return !model.startsWith("image-");
    case "minimax":
      return !model.startsWith("qwen-") && !model.startsWith("wanx-");
  }
}

function readBodyImageMode(
  value: JsonValue | undefined,
  fallback: ArticleBodyImageMode,
): ArticleBodyImageMode {
  const text = stringValue(value);
  return text === "off" || text === "missing" || text === "all"
    ? text
    : fallback;
}

function readVectorStore(
  value: JsonValue | undefined,
  fallback: "sqlite" | "d1",
) {
  const text = stringValue(value);
  return text === "sqlite" || text === "d1" ? text : fallback;
}
