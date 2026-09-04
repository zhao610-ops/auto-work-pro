export const ARTICLE_WORKFLOW_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS article_runs (
  run_id TEXT PRIMARY KEY,
  run_kind TEXT NOT NULL DEFAULT 'single',
  parent_run_id TEXT,
  account_id TEXT,
  profile_id TEXT,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  dry_run INTEGER NOT NULL,
  trigger_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  summary TEXT,
  error TEXT,
  artifacts_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_article_runs_parent
  ON article_runs(parent_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_runs_account
  ON article_runs(account_id, created_at DESC);
CREATE TABLE IF NOT EXISTS article_run_steps (
  run_id TEXT NOT NULL,
  name TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  duration_ms INTEGER,
  input_artifacts_json TEXT NOT NULL DEFAULT '[]',
  output_artifacts_json TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  PRIMARY KEY (run_id, name, attempt)
);
CREATE TABLE IF NOT EXISTS article_publish_results (
  run_id TEXT PRIMARY KEY,
  publish_id TEXT,
  status TEXT,
  platform TEXT,
  url TEXT,
  published_at TEXT,
  result_json TEXT
);
CREATE TABLE IF NOT EXISTS article_vectors (
  id INTEGER PRIMARY KEY,
  content TEXT,
  vector_json TEXT NOT NULL,
  vector_dim INTEGER,
  vector_type TEXT
);
CREATE TABLE IF NOT EXISTS editorial_article_memory (
  run_id TEXT PRIMARY KEY,
  profile_id TEXT,
  account_id TEXT,
  title TEXT NOT NULL,
  thesis TEXT,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  topic_titles_json TEXT NOT NULL DEFAULT '[]',
  source_urls_json TEXT NOT NULL DEFAULT '[]',
  quality_score INTEGER,
  publish_status TEXT NOT NULL,
  dry_run INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_editorial_article_memory_profile_created
  ON editorial_article_memory(profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_editorial_article_memory_account_created
  ON editorial_article_memory(account_id, created_at DESC);
CREATE TABLE IF NOT EXISTS editorial_source_performance (
  url TEXT PRIMARY KEY,
  group_name TEXT NOT NULL,
  runs INTEGER NOT NULL DEFAULT 0,
  successes INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  empty INTEGER NOT NULL DEFAULT 0,
  total_articles INTEGER NOT NULL DEFAULT 0,
  last_status TEXT NOT NULL,
  last_provider TEXT,
  last_error TEXT,
  last_run_id TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_editorial_source_performance_updated
  ON editorial_source_performance(updated_at DESC);
CREATE TABLE IF NOT EXISTS editorial_run_feedback (
  run_id TEXT PRIMARY KEY,
  profile_id TEXT,
  account_id TEXT,
  rating TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_editorial_run_feedback_profile_updated
  ON editorial_run_feedback(profile_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_editorial_run_feedback_account_updated
  ON editorial_run_feedback(account_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS editorial_topic_feedback (
  run_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  profile_id TEXT,
  account_id TEXT,
  action TEXT NOT NULL,
  title TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, topic_id)
);
CREATE INDEX IF NOT EXISTS idx_editorial_topic_feedback_account_updated
  ON editorial_topic_feedback(account_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_editorial_topic_feedback_profile_updated
  ON editorial_topic_feedback(profile_id, updated_at DESC);
`;
