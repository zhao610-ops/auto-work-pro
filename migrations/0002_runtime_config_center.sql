CREATE TABLE IF NOT EXISTS capability_profiles (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  provider TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_capability_profiles_kind
  ON capability_profiles(kind);

CREATE TABLE IF NOT EXISTS feature_profiles (
  id TEXT PRIMARY KEY,
  feature_key TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feature_profiles_feature
  ON feature_profiles(feature_key);

CREATE TABLE IF NOT EXISTS article_sources (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  raw TEXT NOT NULL,
  url TEXT NOT NULL,
  group_name TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_article_sources_profile
  ON article_sources(profile_id, position);

CREATE TABLE IF NOT EXISTS article_fetch_groups (
  profile_id TEXT NOT NULL,
  name TEXT NOT NULL,
  providers_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY(profile_id, name)
);

CREATE TABLE IF NOT EXISTS runtime_schedules (
  id TEXT PRIMARY KEY,
  feature_key TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  cron TEXT NOT NULL,
  timezone TEXT NOT NULL,
  dry_run INTEGER NOT NULL,
  last_triggered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runtime_schedules_feature
  ON runtime_schedules(feature_key, enabled);

CREATE TABLE IF NOT EXISTS runtime_schedule_ticks (
  schedule_id TEXT NOT NULL,
  slot TEXT NOT NULL,
  triggered_at TEXT NOT NULL,
  PRIMARY KEY(schedule_id, slot)
);
