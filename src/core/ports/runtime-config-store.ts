export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export type CapabilityKind =
  | "llm"
  | "image-generation"
  | "notification"
  | "fetch-strategy"
  | "embedding";

export interface CapabilityProfile<TConfig extends JsonObject = JsonObject> {
  id: string;
  kind: CapabilityKind;
  name: string;
  enabled: boolean;
  provider: string;
  config: TConfig;
  version: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeFeatureProfile<
  TConfig extends JsonObject = JsonObject,
> {
  id: string;
  featureKey: string;
  name: string;
  enabled: boolean;
  isDefault: boolean;
  config: TConfig;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeArticleSourceInput {
  raw: string;
  url: string;
  group: string;
  enabled?: boolean;
  position?: number;
}

export interface RuntimeArticleSource extends RuntimeArticleSourceInput {
  id: string;
  profileId: string;
  enabled: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeScheduleInput {
  id?: string;
  featureKey: string;
  profileId: string;
  name: string;
  enabled: boolean;
  cron: string;
  timezone: string;
  dryRun: boolean;
}

export interface RuntimeSchedule extends Required<RuntimeScheduleInput> {
  createdAt: string;
  updatedAt: string;
  lastTriggeredAt?: string;
}

export interface RuntimeScheduleTick {
  schedule: RuntimeSchedule;
  slot: string;
}

export interface WeixinAccountBrandConfig extends JsonObject {
  displayName?: string;
  positioning?: string;
  audience?: string;
  tone?: string;
  titleStyle?: string;
  coverStyle?: string;
  bodyImageStyle?: string;
  forbiddenTopics?: string[];
}

export interface WeixinAccountDefaultsConfig extends JsonObject {
  articleProfileId?: string;
  promptProfile?: string;
  template?: string;
  count?: number;
  sourceGroupIds?: string[];
}

export interface WeixinAccountRelayCheckStatus extends JsonObject {
  checkedAt?: string;
  ok?: boolean;
  status?: string;
  message?: string;
  relayUrl?: string;
  appIdMasked?: string;
}

export interface WeixinAccountOpsConfig extends JsonObject {
  relayCheck?: WeixinAccountRelayCheckStatus;
}

export interface WeixinAccountProfileInput {
  id: string;
  name: string;
  enabled: boolean;
  defaultArticleProfileId?: string;
  brand: WeixinAccountBrandConfig;
  defaults: WeixinAccountDefaultsConfig;
  ops?: WeixinAccountOpsConfig;
}

export interface WeixinAccountProfile extends WeixinAccountProfileInput {
  relay?: {
    configured: boolean;
    defaultConfigured?: boolean;
    appIdMasked?: string;
    lastCheckedAt?: string;
    lastCheck?: WeixinAccountRelayCheckStatus;
  };
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeConfigStore {
  ensureSchema(): Promise<void>;

  listCapabilityProfiles(kind?: CapabilityKind): Promise<CapabilityProfile[]>;
  getCapabilityProfile(id: string): Promise<CapabilityProfile | null>;
  saveCapabilityProfile(
    profile: Omit<CapabilityProfile, "createdAt" | "updatedAt"> & {
      createdAt?: string;
      updatedAt?: string;
    },
  ): Promise<CapabilityProfile>;
  deleteCapabilityProfile(id: string): Promise<boolean>;

  listFeatureProfiles(
    featureKey: string,
  ): Promise<RuntimeFeatureProfile[]>;
  getFeatureProfile(
    featureKey: string,
    profileId?: string,
  ): Promise<RuntimeFeatureProfile | null>;
  saveFeatureProfile(
    profile: Omit<RuntimeFeatureProfile, "createdAt" | "updatedAt"> & {
      createdAt?: string;
      updatedAt?: string;
    },
  ): Promise<RuntimeFeatureProfile>;
  deleteFeatureProfile(featureKey: string, profileId: string): Promise<boolean>;

  listArticleSources(profileId: string): Promise<RuntimeArticleSource[]>;
  replaceArticleSources(
    profileId: string,
    sources: RuntimeArticleSourceInput[],
  ): Promise<RuntimeArticleSource[]>;

  getArticleFetchGroups(profileId: string): Promise<Record<string, string[]>>;
  replaceArticleFetchGroups(
    profileId: string,
    groups: Record<string, string[]>,
  ): Promise<Record<string, string[]>>;

  getSchedule(profileId: string): Promise<RuntimeSchedule | null>;
  saveSchedule(input: RuntimeScheduleInput): Promise<RuntimeSchedule>;
  listDueSchedules(now: Date): Promise<RuntimeScheduleTick[]>;
  markScheduleTriggered(scheduleId: string, slot: string): Promise<boolean>;

  listWeixinAccountProfiles(): Promise<WeixinAccountProfile[]>;
  getWeixinAccountProfile(id: string): Promise<WeixinAccountProfile | null>;
  saveWeixinAccountProfile(
    profile: Omit<WeixinAccountProfile, "createdAt" | "updatedAt"> & {
      createdAt?: string;
      updatedAt?: string;
    },
  ): Promise<WeixinAccountProfile>;
  deleteWeixinAccountProfile(id: string): Promise<boolean>;
}
