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
