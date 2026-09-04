import type {
  CapabilityKind,
  CapabilityProfile,
  RuntimeArticleSource,
  RuntimeArticleSourceInput,
  RuntimeConfigStore,
  RuntimeFeatureProfile,
  RuntimeSchedule,
  RuntimeScheduleInput,
  RuntimeScheduleTick,
  WeixinAccountProfile,
} from "@src/core/ports/runtime-config-store.ts";
import {
  RUNTIME_CONFIG_SCHEMA_SQL,
  splitSqlStatements,
} from "@src/core/storage/runtime-config-schema.ts";
import {
  CapabilityProfileRow,
  createScheduleSlot,
  FeatureProfileRow,
  isCronDue,
  nowIso,
  parseStringArray,
  rowToCapabilityProfile,
  rowToFeatureProfile,
  rowToRuntimeSchedule,
  rowToWeixinAccountProfile,
  RuntimeScheduleRow,
  WeixinAccountProfileRow,
} from "@src/core/storage/runtime-config-utils.ts";
import type { CloudflareD1Database } from "@src/platform/cloudflare/cloudflare-bindings.ts";

export class D1RuntimeConfigStore implements RuntimeConfigStore {
  private schemaReady = false;

  constructor(private readonly d1: CloudflareD1Database) {}

  async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    for (const statement of splitSqlStatements(RUNTIME_CONFIG_SCHEMA_SQL)) {
      await this.d1.prepare(statement).run();
    }
    await this.ensureSchemaUpgrades();
    this.schemaReady = true;
  }

  async listCapabilityProfiles(
    kind?: CapabilityKind,
  ): Promise<CapabilityProfile[]> {
    await this.ensureSchema();
    const result = kind
      ? await this.d1.prepare(
        "SELECT * FROM capability_profiles WHERE kind = ? ORDER BY is_default DESC, name ASC",
      ).bind(kind).all<CapabilityProfileRow>()
      : await this.d1.prepare(
        "SELECT * FROM capability_profiles ORDER BY kind ASC, is_default DESC, name ASC",
      ).all<CapabilityProfileRow>();
    return result.results.map(rowToCapabilityProfile);
  }

  async getCapabilityProfile(id: string): Promise<CapabilityProfile | null> {
    await this.ensureSchema();
    const row = await this.d1.prepare(
      "SELECT * FROM capability_profiles WHERE id = ?",
    ).bind(id).first<CapabilityProfileRow>();
    return row ? rowToCapabilityProfile(row) : null;
  }

  async saveCapabilityProfile(
    profile: Omit<CapabilityProfile, "createdAt" | "updatedAt"> & {
      createdAt?: string;
      updatedAt?: string;
    },
  ): Promise<CapabilityProfile> {
    await this.ensureSchema();
    const existing = await this.getCapabilityProfile(profile.id);
    const timestamp = nowIso();
    const createdAt = profile.createdAt || existing?.createdAt || timestamp;
    const updatedAt = profile.updatedAt || timestamp;
    await this.d1.prepare(
      `INSERT OR REPLACE INTO capability_profiles
      (id, kind, name, enabled, provider, config_json, version, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      profile.id,
      profile.kind,
      profile.name,
      profile.enabled ? 1 : 0,
      profile.provider,
      JSON.stringify(profile.config ?? {}),
      profile.version,
      profile.isDefault ? 1 : 0,
      createdAt,
      updatedAt,
    ).run();
    return { ...profile, createdAt, updatedAt };
  }

  async deleteCapabilityProfile(id: string): Promise<boolean> {
    await this.ensureSchema();
    const existing = await this.getCapabilityProfile(id);
    if (!existing) return false;
    await this.d1.prepare("DELETE FROM capability_profiles WHERE id = ?").bind(
      id,
    ).run();
    return true;
  }

  async listFeatureProfiles(
    featureKey: string,
  ): Promise<RuntimeFeatureProfile[]> {
    await this.ensureSchema();
    const result = await this.d1.prepare(
      "SELECT * FROM feature_profiles WHERE feature_key = ? ORDER BY is_default DESC, name ASC",
    ).bind(featureKey).all<FeatureProfileRow>();
    return result.results.map(rowToFeatureProfile);
  }

  async getFeatureProfile(
    featureKey: string,
    profileId?: string,
  ): Promise<RuntimeFeatureProfile | null> {
    await this.ensureSchema();
    const row = profileId
      ? await this.d1.prepare(
        "SELECT * FROM feature_profiles WHERE feature_key = ? AND id = ?",
      ).bind(featureKey, profileId).first<FeatureProfileRow>()
      : await this.d1.prepare(
        "SELECT * FROM feature_profiles WHERE feature_key = ? AND is_default = 1 ORDER BY updated_at DESC LIMIT 1",
      ).bind(featureKey).first<FeatureProfileRow>();
    return row ? rowToFeatureProfile(row) : null;
  }

  async saveFeatureProfile(
    profile: Omit<RuntimeFeatureProfile, "createdAt" | "updatedAt"> & {
      createdAt?: string;
      updatedAt?: string;
    },
  ): Promise<RuntimeFeatureProfile> {
    await this.ensureSchema();
    const existing = await this.getFeatureProfile(
      profile.featureKey,
      profile.id,
    );
    const timestamp = nowIso();
    const createdAt = profile.createdAt || existing?.createdAt || timestamp;
    const updatedAt = profile.updatedAt || timestamp;
    if (profile.isDefault) {
      await this.d1.prepare(
        "UPDATE feature_profiles SET is_default = 0, updated_at = ? WHERE feature_key = ? AND id <> ?",
      ).bind(updatedAt, profile.featureKey, profile.id).run();
    }
    await this.d1.prepare(
      `INSERT OR REPLACE INTO feature_profiles
      (id, feature_key, name, enabled, is_default, config_json, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      profile.id,
      profile.featureKey,
      profile.name,
      profile.enabled ? 1 : 0,
      profile.isDefault ? 1 : 0,
      JSON.stringify(profile.config ?? {}),
      profile.version,
      createdAt,
      updatedAt,
    ).run();
    return { ...profile, createdAt, updatedAt };
  }

  async deleteFeatureProfile(
    featureKey: string,
    profileId: string,
  ): Promise<boolean> {
    await this.ensureSchema();
    const existing = await this.getFeatureProfile(featureKey, profileId);
    if (!existing) return false;
    await this.d1.prepare("DELETE FROM article_sources WHERE profile_id = ?")
      .bind(profileId).run();
    await this.d1.prepare(
      "DELETE FROM article_fetch_groups WHERE profile_id = ?",
    ).bind(profileId).run();
    await this.d1.prepare("DELETE FROM runtime_schedules WHERE profile_id = ?")
      .bind(profileId).run();
    await this.d1.prepare(
      "DELETE FROM feature_profiles WHERE feature_key = ? AND id = ?",
    ).bind(featureKey, profileId).run();
    return true;
  }

  async listArticleSources(profileId: string): Promise<RuntimeArticleSource[]> {
    await this.ensureSchema();
    const result = await this.d1.prepare(
      "SELECT * FROM article_sources WHERE profile_id = ? ORDER BY position ASC, created_at ASC",
    ).bind(profileId).all<ArticleSourceRow>();
    return result.results.map(rowToArticleSource);
  }

  async replaceArticleSources(
    profileId: string,
    sources: RuntimeArticleSourceInput[],
  ): Promise<RuntimeArticleSource[]> {
    await this.ensureSchema();
    await this.requireFeatureProfile(profileId);
    await this.d1.prepare("DELETE FROM article_sources WHERE profile_id = ?")
      .bind(profileId).run();
    const timestamp = nowIso();
    for (let index = 0; index < sources.length; index++) {
      const source = sources[index];
      await this.d1.prepare(
        `INSERT INTO article_sources
        (id, profile_id, raw, url, group_name, enabled, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        `src-${crypto.randomUUID()}`,
        profileId,
        source.raw,
        source.url,
        source.group,
        source.enabled === false ? 0 : 1,
        source.position ?? index,
        timestamp,
        timestamp,
      ).run();
    }
    return await this.listArticleSources(profileId);
  }

  async getArticleFetchGroups(
    profileId: string,
  ): Promise<Record<string, string[]>> {
    await this.ensureSchema();
    const result = await this.d1.prepare(
      "SELECT * FROM article_fetch_groups WHERE profile_id = ? ORDER BY name ASC",
    ).bind(profileId).all<FetchGroupRow>();
    return Object.fromEntries(
      result.results.map((row) => [
        row.name,
        parseStringArray(row.providers_json),
      ]),
    );
  }

  async replaceArticleFetchGroups(
    profileId: string,
    groups: Record<string, string[]>,
  ): Promise<Record<string, string[]>> {
    await this.ensureSchema();
    await this.requireFeatureProfile(profileId);
    await this.d1.prepare(
      "DELETE FROM article_fetch_groups WHERE profile_id = ?",
    ).bind(profileId).run();
    const timestamp = nowIso();
    for (const [name, providers] of Object.entries(groups)) {
      await this.d1.prepare(
        `INSERT INTO article_fetch_groups
        (profile_id, name, providers_json, updated_at)
        VALUES (?, ?, ?, ?)`,
      ).bind(profileId, name, JSON.stringify(providers), timestamp).run();
    }
    return await this.getArticleFetchGroups(profileId);
  }

  async getSchedule(profileId: string): Promise<RuntimeSchedule | null> {
    await this.ensureSchema();
    const row = await this.d1.prepare(
      "SELECT * FROM runtime_schedules WHERE profile_id = ? ORDER BY updated_at DESC LIMIT 1",
    ).bind(profileId).first<RuntimeScheduleRow>();
    return row ? rowToRuntimeSchedule(row) : null;
  }

  async saveSchedule(input: RuntimeScheduleInput): Promise<RuntimeSchedule> {
    await this.ensureSchema();
    await this.requireFeatureProfile(input.profileId);
    const existing = input.id
      ? await this.d1.prepare("SELECT * FROM runtime_schedules WHERE id = ?")
        .bind(input.id).first<RuntimeScheduleRow>()
      : null;
    const timestamp = nowIso();
    const id = input.id ?? existing?.id ?? `sch-${crypto.randomUUID()}`;
    const createdAt = existing?.created_at ?? timestamp;
    await this.d1.prepare(
      "DELETE FROM runtime_schedules WHERE profile_id = ? AND id <> ?",
    ).bind(input.profileId, id).run();
    await this.d1.prepare(
      `INSERT OR REPLACE INTO runtime_schedules
      (id, feature_key, profile_id, name, enabled, cron, timezone, dry_run, last_triggered_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      input.featureKey,
      input.profileId,
      input.name,
      input.enabled ? 1 : 0,
      input.cron,
      input.timezone,
      input.dryRun ? 1 : 0,
      existing?.last_triggered_at ?? null,
      createdAt,
      timestamp,
    ).run();
    const saved = await this.getSchedule(input.profileId);
    if (!saved) throw new Error(`定时配置保存失败: ${input.profileId}`);
    return saved;
  }

  async listDueSchedules(now: Date): Promise<RuntimeScheduleTick[]> {
    await this.ensureSchema();
    const result = await this.d1.prepare(
      "SELECT * FROM runtime_schedules WHERE enabled = 1",
    ).all<RuntimeScheduleRow>();
    return result.results.map(rowToRuntimeSchedule)
      .filter((schedule) => isCronDue(schedule.cron, now, schedule.timezone))
      .map((schedule) => ({
        schedule,
        slot: createScheduleSlot(schedule.id, now, schedule.timezone),
      }));
  }

  async markScheduleTriggered(
    scheduleId: string,
    slot: string,
  ): Promise<boolean> {
    await this.ensureSchema();
    const timestamp = nowIso();
    try {
      await this.d1.prepare(
        "INSERT INTO runtime_schedule_ticks (schedule_id, slot, triggered_at) VALUES (?, ?, ?)",
      ).bind(scheduleId, slot, timestamp).run();
      await this.d1.prepare(
        "UPDATE runtime_schedules SET last_triggered_at = ?, updated_at = ? WHERE id = ?",
      ).bind(timestamp, timestamp, scheduleId).run();
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        return false;
      }
      throw error;
    }
  }

  async listWeixinAccountProfiles(): Promise<WeixinAccountProfile[]> {
    await this.ensureSchema();
    const result = await this.d1.prepare(
      "SELECT * FROM weixin_account_profiles ORDER BY enabled DESC, name ASC",
    ).all<WeixinAccountProfileRow>();
    return result.results.map(rowToWeixinAccountProfile);
  }

  async getWeixinAccountProfile(
    id: string,
  ): Promise<WeixinAccountProfile | null> {
    await this.ensureSchema();
    const row = await this.d1.prepare(
      "SELECT * FROM weixin_account_profiles WHERE id = ?",
    ).bind(id).first<WeixinAccountProfileRow>();
    return row ? rowToWeixinAccountProfile(row) : null;
  }

  async saveWeixinAccountProfile(
    profile: Omit<WeixinAccountProfile, "createdAt" | "updatedAt"> & {
      createdAt?: string;
      updatedAt?: string;
    },
  ): Promise<WeixinAccountProfile> {
    await this.ensureSchema();
    const existing = await this.getWeixinAccountProfile(profile.id);
    const timestamp = nowIso();
    const createdAt = profile.createdAt || existing?.createdAt || timestamp;
    const updatedAt = profile.updatedAt || timestamp;
    await this.d1.prepare(
      `INSERT OR REPLACE INTO weixin_account_profiles
      (id, name, enabled, default_article_profile_id, brand_json, defaults_json, ops_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      profile.id,
      profile.name,
      profile.enabled ? 1 : 0,
      profile.defaultArticleProfileId ?? null,
      JSON.stringify(profile.brand ?? {}),
      JSON.stringify(profile.defaults ?? {}),
      JSON.stringify(profile.ops ?? existing?.ops ?? {}),
      createdAt,
      updatedAt,
    ).run();
    return {
      ...profile,
      ops: profile.ops ?? existing?.ops ?? {},
      createdAt,
      updatedAt,
    };
  }

  async deleteWeixinAccountProfile(id: string): Promise<boolean> {
    await this.ensureSchema();
    const existing = await this.getWeixinAccountProfile(id);
    if (!existing) return false;
    await this.d1.prepare("DELETE FROM weixin_account_profiles WHERE id = ?")
      .bind(id).run();
    return true;
  }

  private async requireFeatureProfile(profileId: string): Promise<void> {
    const row = await this.d1.prepare(
      "SELECT id FROM feature_profiles WHERE id = ?",
    ).bind(profileId).first<{ id: string }>();
    if (!row) {
      throw new Error(`功能 Profile 不存在: ${profileId}`);
    }
  }

  private async ensureSchemaUpgrades(): Promise<void> {
    for (
      const statement of [
        "ALTER TABLE weixin_account_profiles ADD COLUMN ops_json TEXT NOT NULL DEFAULT '{}'",
      ]
    ) {
      try {
        await this.d1.prepare(statement).run();
      } catch (error) {
        const message = error instanceof Error
          ? error.message.toLowerCase()
          : String(error);
        if (!message.includes("duplicate column")) {
          throw error;
        }
      }
    }
  }
}

interface ArticleSourceRow {
  id: string;
  profile_id: string;
  raw: string;
  url: string;
  group_name: string;
  enabled: number;
  position: number;
  created_at: string;
  updated_at: string;
}

interface FetchGroupRow {
  profile_id: string;
  name: string;
  providers_json: string | null;
  updated_at: string;
}

function rowToArticleSource(row: ArticleSourceRow): RuntimeArticleSource {
  return {
    id: row.id,
    profileId: row.profile_id,
    raw: row.raw,
    url: row.url,
    group: row.group_name,
    enabled: Boolean(row.enabled),
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
