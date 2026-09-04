ALTER TABLE article_runs ADD COLUMN run_kind TEXT NOT NULL DEFAULT 'single';
ALTER TABLE article_runs ADD COLUMN parent_run_id TEXT;
ALTER TABLE article_runs ADD COLUMN account_id TEXT;
ALTER TABLE article_runs ADD COLUMN profile_id TEXT;

CREATE INDEX IF NOT EXISTS idx_article_runs_parent
  ON article_runs(parent_run_id);
CREATE INDEX IF NOT EXISTS idx_article_runs_account
  ON article_runs(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS weixin_account_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  default_article_profile_id TEXT,
  brand_json TEXT NOT NULL DEFAULT '{}',
  defaults_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_weixin_account_profiles_enabled
  ON weixin_account_profiles(enabled);
