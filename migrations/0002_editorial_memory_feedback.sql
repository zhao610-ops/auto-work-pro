CREATE TABLE IF NOT EXISTS editorial_article_memory (
  run_id TEXT PRIMARY KEY,
  profile_id TEXT,
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
  rating TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_editorial_run_feedback_profile_updated
  ON editorial_run_feedback(profile_id, updated_at DESC);
