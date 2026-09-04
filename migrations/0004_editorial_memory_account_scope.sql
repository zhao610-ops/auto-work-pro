ALTER TABLE editorial_article_memory ADD COLUMN account_id TEXT;
ALTER TABLE editorial_run_feedback ADD COLUMN account_id TEXT;

CREATE INDEX IF NOT EXISTS idx_editorial_article_memory_account_created
  ON editorial_article_memory(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_editorial_run_feedback_account_updated
  ON editorial_run_feedback(account_id, updated_at DESC);
