import { Database } from "@db/sqlite";
import { dirname } from "node:path";
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

export class SQLiteRuntimeConfigStore implements RuntimeConfigStore {
  private db?: Database;

  constructor(private readonly databasePath: string) {}

  async ensureSchema(): Promise<void> {
    this.getDb();
  }

  async listCapabilityProfiles(
    kind?: CapabilityKind,
  ): Promise<CapabilityProfile[]> {
    const db = this.getDb();
    const rows = kind
      ? db.prepare(
        "SELECT * FROM capability_profiles WHERE kind = ? ORDER BY is_default DESC, name ASC",
      ).all(kind) as CapabilityProfileRow[]
      : db.prepare(
        "SELECT * FROM capability_profiles ORDER BY kind ASC, is_default DESC, name ASC",
      ).all() as CapabilityProfileRow[];
    return rows.map(rowToCapabilityProfile);
  }

  async getCapabilityProfile(id: string): Promise<CapabilityProfile | null> {
    const row = this.getDb().prepare(
      "SELECT * FROM capability_profiles WHERE id = ?",
    ).get(id) as CapabilityProfileRow | undefined;
    return row ? rowToCapabilityProfile(row) : null;
  }

  async saveCapabilityProfile(
    profile: Omit<CapabilityProfile, "createdAt" | "updatedAt"> & {
      createdAt?: string;
      updatedAt?: string;
    },
  ): Promise<CapabilityProfile> {
    const existing = await this.getCapabilityProfile(profile.id);
    const timestamp = nowIso();
    const createdAt = profile.createdAt || existing?.createdAt || timestamp;
    const updatedAt = profile.updatedAt || timestamp;
    this.getDb().prepare(
      `INSERT OR REPLACE INTO capability_profiles
      (id, kind, name, enabled, provider, config_json, version, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
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
    );
    return {
      ...profile,
      createdAt,
      updatedAt,
    };
  }

  async deleteCapabilityProfile(id: string): Promise<boolean> {
    const existing = await this.getCapabilityProfile(id);
    if (!existing) return false;
    this.getDb().prepare("DELETE FROM capability_profiles WHERE id = ?").run(
      id,
    );
    return true;
  }

  async listFeatureProfiles(
    featureKey: string,
  ): Promise<RuntimeFeatureProfile[]> {
    const rows = this.getDb().prepare(
      "SELECT * FROM feature_profiles WHERE feature_key = ? ORDER BY is_default DESC, name ASC",
    ).all(featureKey) as FeatureProfileRow[];
    return rows.map(rowToFeatureProfile);
  }

  async getFeatureProfile(
    featureKey: string,
    profileId?: string,
  ): Promise<RuntimeFeatureProfile | null> {
    const row = profileId
      ? this.getDb().prepare(
        "SELECT * FROM feature_profiles WHERE feature_key = ? AND id = ?",
      ).get(featureKey, profileId) as FeatureProfileRow | undefined
      : this.getDb().prepare(
        "SELECT * FROM feature_profiles WHERE feature_key = ? AND is_default = 1 ORDER BY updated_at DESC LIMIT 1",
      ).get(featureKey) as FeatureProfileRow | undefined;
    return row ? rowToFeatureProfile(row) : null;
  }

  async saveFeatureProfile(
    profile: Omit<RuntimeFeatureProfile, "createdAt" | "updatedAt"> & {
      createdAt?: string;
      updatedAt?: string;
    },
  ): Promise<RuntimeFeatureProfile> {
    const existing = await this.getFeatureProfile(
      profile.featureKey,
      profile.id,
    );
    const timestamp = nowIso();
    const createdAt = profile.createdAt || existing?.createdAt || timestamp;
    const updatedAt = profile.updatedAt || timestamp;
    if (profile.isDefault) {
      this.getDb().prepare(
        "UPDATE feature_profiles SET is_default = 0, updated_at = ? WHERE feature_key = ? AND id <> ?",
      ).run(updatedAt, profile.featureKey, profile.id);
    }
    this.getDb().prepare(
      `INSERT OR REPLACE INTO feature_profiles
      (id, feature_key, name, enabled, is_default, config_json, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      profile.id,
      profile.featureKey,
      profile.name,
      profile.enabled ? 1 : 0,
      profile.isDefault ? 1 : 0,
      JSON.stringify(profile.config ?? {}),
      profile.version,
      createdAt,
      updatedAt,
    );
    return { ...profile, createdAt, updatedAt };
  }

  async deleteFeatureProfile(
    featureKey: string,
    profileId: string,
  ): Promise<boolean> {
    const existing = await this.getFeatureProfile(featureKey, profileId);
    if (!existing) return false;
    const db = this.getDb();
    db.prepare("DELETE FROM article_sources WHERE profile_id = ?").run(
      profileId,
    );
    db.prepare("DELETE FROM article_fetch_groups WHERE profile_id = ?").run(
      profileId,
    );
    db.prepare("DELETE FROM runtime_schedules WHERE profile_id = ?").run(
      profileId,
    );
    db.prepare("DELETE FROM feature_profiles WHERE feature_key = ? AND id = ?")
      .run(featureKey, profileId);
    return true;
  }

  async listArticleSources(profileId: string): Promise<RuntimeArticleSource[]> {
    const rows = this.getDb().prepare(
      "SELECT * FROM article_sources WHERE profile_id = ? ORDER BY position ASC, created_at ASC",
    ).all(profileId) as ArticleSourceRow[];
    return rows.map(rowToArticleSource);
  }

  async replaceArticleSources(
    profileId: string,
    sources: RuntimeArticleSourceInput[],
  ): Promise<RuntimeArticleSource[]> {
    const db = this.getDb();
    this.requireFeatureProfile(profileId);
    db.prepare("DELETE FROM article_sources WHERE profile_id = ?").run(
      profileId,
    );
    const timestamp = nowIso();
    sources.forEach((source, index) => {
      db.prepare(
        `INSERT INTO article_sources
        (id, profile_id, raw, url, group_name, enabled, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        `src-${crypto.randomUUID()}`,
        profileId,
        source.raw,
        source.url,
        source.group,
        source.enabled === false ? 0 : 1,
        source.position ?? index,
        timestamp,
        timestamp,
      );
    });
    return await this.listArticleSources(profileId);
  }

  async getArticleFetchGroups(
    profileId: string,
  ): Promise<Record<string, string[]>> {
    const rows = this.getDb().prepare(
      "SELECT * FROM article_fetch_groups WHERE profile_id = ? ORDER BY name ASC",
    ).all(profileId) as FetchGroupRow[];
    return Object.fromEntries(
      rows.map((row) => [row.name, parseStringArray(row.providers_json)]),
    );
  }

  async replaceArticleFetchGroups(
    profileId: string,
    groups: Record<string, string[]>,
  ): Promise<Record<string, string[]>> {
    const db = this.getDb();
    this.requireFeatureProfile(profileId);
    db.prepare("DELETE FROM article_fetch_groups WHERE profile_id = ?").run(
      profileId,
    );
    const timestamp = nowIso();
    for (const [name, providers] of Object.entries(groups)) {
      db.prepare(
        `INSERT INTO article_fetch_groups
        (profile_id, name, providers_json, updated_at)
        VALUES (?, ?, ?, ?)`,
      ).run(profileId, name, JSON.stringify(providers), timestamp);
    }
    return await this.getArticleFetchGroups(profileId);
  }

  async getSchedule(profileId: string): Promise<RuntimeSchedule | null> {
    const row = this.getDb().prepare(
      "SELECT * FROM runtime_schedules WHERE profile_id = ? ORDER BY updated_at DESC LIMIT 1",
    ).get(profileId) as RuntimeScheduleRow | undefined;
    return row ? rowToRuntimeSchedule(row) : null;
  }

  async saveSchedule(input: RuntimeScheduleInput): Promise<RuntimeSchedule> {
    this.requireFeatureProfile(input.profileId);
    const existing = input.id
      ? this.getDb().prepare("SELECT * FROM runtime_schedules WHERE id = ?")
        .get(input.id) as RuntimeScheduleRow | undefined
      : undefined;
    const timestamp = nowIso();
    const id = input.id ?? existing?.id ?? `sch-${crypto.randomUUID()}`;
    const createdAt = existing?.created_at ?? timestamp;
    this.getDb().prepare(
      "DELETE FROM runtime_schedules WHERE profile_id = ? AND id <> ?",
    ).run(input.profileId, id);
    this.getDb().prepare(
      `INSERT OR REPLACE INTO runtime_schedules
      (id, feature_key, profile_id, name, enabled, cron, timezone, dry_run, last_triggered_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
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
    );
    const saved = await this.getSchedule(input.profileId);
    if (!saved) throw new Error(`定时配置保存失败: ${input.profileId}`);
    return saved;
  }

  async listDueSchedules(now: Date): Promise<RuntimeScheduleTick[]> {
    const rows = this.getDb().prepare(
      "SELECT * FROM runtime_schedules WHERE enabled = 1",
    ).all() as RuntimeScheduleRow[];
    return rows.map(rowToRuntimeSchedule)
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
    const timestamp = nowIso();
    try {
      this.getDb().prepare(
        "INSERT INTO runtime_schedule_ticks (schedule_id, slot, triggered_at) VALUES (?, ?, ?)",
      ).run(scheduleId, slot, timestamp);
      this.getDb().prepare(
        "UPDATE runtime_schedules SET last_triggered_at = ?, updated_at = ? WHERE id = ?",
      ).run(timestamp, timestamp, scheduleId);
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        return false;
      }
      throw error;
    }
  }

  async listWeixinAccountProfiles(): Promise<WeixinAccountProfile[]> {
    const rows = this.getDb().prepare(
      "SELECT * FROM weixin_account_profiles ORDER BY enabled DESC, name ASC",
    ).all() as WeixinAccountProfileRow[];
    return rows.map(rowToWeixinAccountProfile);
  }

  async getWeixinAccountProfile(
    id: string,
  ): Promise<WeixinAccountProfile | null> {
    const row = this.getDb().prepare(
      "SELECT * FROM weixin_account_profiles WHERE id = ?",
    ).get(id) as WeixinAccountProfileRow | undefined;
    return row ? rowToWeixinAccountProfile(row) : null;
  }

  async saveWeixinAccountProfile(
    profile: Omit<WeixinAccountProfile, "createdAt" | "updatedAt"> & {
      createdAt?: string;
      updatedAt?: string;
    },
  ): Promise<WeixinAccountProfile> {
    const existing = await this.getWeixinAccountProfile(profile.id);
    const timestamp = nowIso();
    const createdAt = profile.createdAt || existing?.createdAt || timestamp;
    const updatedAt = profile.updatedAt || timestamp;
    this.getDb().prepare(
      `INSERT OR REPLACE INTO weixin_account_profiles
      (id, name, enabled, default_article_profile_id, brand_json, defaults_json, ops_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      profile.id,
      profile.name,
      profile.enabled ? 1 : 0,
      profile.defaultArticleProfileId ?? null,
      JSON.stringify(profile.brand ?? {}),
      JSON.stringify(profile.defaults ?? {}),
      JSON.stringify(profile.ops ?? existing?.ops ?? {}),
      createdAt,
      updatedAt,
    );
    return {
      ...profile,
      ops: profile.ops ?? existing?.ops ?? {},
      createdAt,
      updatedAt,
    };
  }

  async deleteWeixinAccountProfile(id: string): Promise<boolean> {
    const existing = await this.getWeixinAccountProfile(id);
    if (!existing) return false;
    this.getDb().prepare("DELETE FROM weixin_account_profiles WHERE id = ?")
      .run(id);
    return true;
  }

  private getDb(): Database {
    if (!this.db) {
      if (this.databasePath !== ":memory:") {
        Deno.mkdirSync(dirname(this.databasePath), { recursive: true });
      }
      this.db = new Database(this.databasePath);
      this.db.exec(RUNTIME_CONFIG_SCHEMA_SQL);
      this.ensureSchemaUpgrades();
    }
    return this.db;
  }

  private ensureSchemaUpgrades(): void {
    for (
      const statement of [
        "ALTER TABLE weixin_account_profiles ADD COLUMN ops_json TEXT NOT NULL DEFAULT '{}'",
      ]
    ) {
      try {
        this.db?.exec(statement);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.toLowerCase().includes("duplicate column")
        ) {
          throw error;
        }
      }
    }
  }

  private requireFeatureProfile(profileId: string): void {
    const row = this.getDb().prepare(
      "SELECT id FROM feature_profiles WHERE id = ?",
    ).get(profileId) as { id: string } | undefined;
    if (!row) {
      throw new Error(`功能 Profile 不存在: ${profileId}`);
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
