import { ARTICLE_WORKFLOW_SCHEMA_SQL } from "@src/core/storage/article-workflow-schema.ts";
import type {
  EditorialArticleMemory,
  EditorialArticleMemoryInput,
  EditorialMemoryContext,
  EditorialMemoryStore,
  EditorialRunFeedback,
  EditorialRunFeedbackInput,
  EditorialSourceHealthReport,
  EditorialTopicFeedback,
  EditorialTopicFeedbackInput,
  SourcePerformanceRecord,
} from "@src/core/ports/editorial-memory-store.ts";
import type { CloudflareD1Database } from "@src/platform/cloudflare/cloudflare-bindings.ts";
import { splitSqlStatements } from "@src/core/storage/runtime-config-schema.ts";

export class D1EditorialMemoryStore implements EditorialMemoryStore {
  private schemaReady = false;

  constructor(private readonly db: CloudflareD1Database) {}

  async getContext(options: {
    profileId?: string;
    accountId?: string;
    strictAccount?: boolean;
    recentLimit?: number;
    sourceLimit?: number;
  } = {}): Promise<EditorialMemoryContext> {
    await this.ensureSchema();
    const recentLimit = options.recentLimit ?? 12;
    const sourceLimit = options.sourceLimit ?? 30;
    const articleResult = options.accountId && options.strictAccount
      ? options.accountId === "default"
        ? await this.db.prepare(
          `SELECT * FROM editorial_article_memory
          WHERE account_id = ? OR account_id IS NULL
          ORDER BY created_at DESC
          LIMIT ?`,
        ).bind(options.accountId, recentLimit).all<ArticleMemoryRow>()
        : await this.db.prepare(
          `SELECT * FROM editorial_article_memory
        WHERE account_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
        ).bind(options.accountId, recentLimit).all<ArticleMemoryRow>()
      : options.accountId
      ? await this.db.prepare(
        `SELECT * FROM editorial_article_memory
        WHERE account_id = ? OR account_id IS NULL
        ORDER BY CASE WHEN account_id = ? THEN 0 ELSE 1 END, created_at DESC
        LIMIT ?`,
      ).bind(options.accountId, options.accountId, recentLimit).all<
        ArticleMemoryRow
      >()
      : options.profileId
      ? await this.db.prepare(
        "SELECT * FROM editorial_article_memory WHERE profile_id = ? OR profile_id IS NULL ORDER BY created_at DESC LIMIT ?",
      ).bind(options.profileId, recentLimit).all<ArticleMemoryRow>()
      : await this.db.prepare(
        "SELECT * FROM editorial_article_memory ORDER BY created_at DESC LIMIT ?",
      ).bind(recentLimit).all<ArticleMemoryRow>();
    const sourceResult = await this.db.prepare(
      "SELECT * FROM editorial_source_performance ORDER BY updated_at DESC LIMIT ?",
    ).bind(sourceLimit).all<SourcePerformanceRow>();
    const feedbackResult = options.accountId && options.strictAccount
      ? options.accountId === "default"
        ? await this.db.prepare(
          `SELECT * FROM editorial_run_feedback
          WHERE account_id = ? OR account_id IS NULL
          ORDER BY updated_at DESC
          LIMIT ?`,
        ).bind(options.accountId, recentLimit).all<FeedbackRow>()
        : await this.db.prepare(
          `SELECT * FROM editorial_run_feedback
        WHERE account_id = ?
        ORDER BY updated_at DESC
        LIMIT ?`,
        ).bind(options.accountId, recentLimit).all<FeedbackRow>()
      : options.accountId
      ? await this.db.prepare(
        `SELECT * FROM editorial_run_feedback
        WHERE account_id = ? OR account_id IS NULL
        ORDER BY CASE WHEN account_id = ? THEN 0 ELSE 1 END, updated_at DESC
        LIMIT ?`,
      ).bind(options.accountId, options.accountId, recentLimit).all<
        FeedbackRow
      >()
      : options.profileId
      ? await this.db.prepare(
        "SELECT * FROM editorial_run_feedback WHERE profile_id = ? OR profile_id IS NULL ORDER BY updated_at DESC LIMIT ?",
      ).bind(options.profileId, recentLimit).all<FeedbackRow>()
      : await this.db.prepare(
        "SELECT * FROM editorial_run_feedback ORDER BY updated_at DESC LIMIT ?",
      ).bind(recentLimit).all<FeedbackRow>();
    const topicFeedbackRows = await this.listTopicFeedbackRows(options);
    return {
      recentArticles: articleResult.results.map(rowToArticleMemory),
      sourcePerformance: sourceResult.results.map(rowToSourcePerformance),
      recentFeedback: feedbackResult.results.map(rowToFeedback),
      recentTopicFeedback: topicFeedbackRows.map(rowToTopicFeedback),
    };
  }

  async recordArticle(input: EditorialArticleMemoryInput): Promise<void> {
    await this.ensureSchema();
    const createdAt = input.createdAt ?? new Date().toISOString();
    await this.db.prepare(
      `INSERT OR REPLACE INTO editorial_article_memory
      (run_id, profile_id, account_id, title, thesis, keywords_json, topic_titles_json, source_urls_json, quality_score, publish_status, dry_run, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.runId,
      input.profileId ?? null,
      input.accountId ?? null,
      input.title,
      input.thesis ?? null,
      JSON.stringify(input.keywords),
      JSON.stringify(input.topicTitles),
      JSON.stringify(input.sourceUrls),
      input.qualityScore ?? null,
      input.publishStatus,
      input.dryRun ? 1 : 0,
      createdAt,
    ).run();
  }

  async recordSourceHealth(
    runId: string,
    report: EditorialSourceHealthReport,
  ): Promise<void> {
    await this.ensureSchema();
    const updatedAt = report.generatedAt || new Date().toISOString();
    for (const record of report.records) {
      const error = record.failures[0]
        ? `${record.failures[0].provider}: ${record.failures[0].message}`
        : null;
      await this.db.prepare(
        `INSERT INTO editorial_source_performance
        (url, group_name, runs, successes, failures, empty, total_articles, last_status, last_provider, last_error, last_run_id, updated_at)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET
          group_name = excluded.group_name,
          runs = editorial_source_performance.runs + 1,
          successes = editorial_source_performance.successes + excluded.successes,
          failures = editorial_source_performance.failures + excluded.failures,
          empty = editorial_source_performance.empty + excluded.empty,
          total_articles = editorial_source_performance.total_articles + excluded.total_articles,
          last_status = excluded.last_status,
          last_provider = excluded.last_provider,
          last_error = excluded.last_error,
          last_run_id = excluded.last_run_id,
          updated_at = excluded.updated_at`,
      ).bind(
        record.url,
        record.group,
        record.status === "succeeded" ? 1 : 0,
        record.status === "failed" ? 1 : 0,
        record.status === "empty" ? 1 : 0,
        record.articleCount,
        record.status,
        record.selectedProvider ?? null,
        error,
        runId,
        updatedAt,
      ).run();
    }
  }

  async getFeedback(runId: string): Promise<EditorialRunFeedback | null> {
    await this.ensureSchema();
    const row = await this.db.prepare(
      "SELECT * FROM editorial_run_feedback WHERE run_id = ?",
    ).bind(runId).first<FeedbackRow>();
    return row ? rowToFeedback(row) : null;
  }

  async saveFeedback(
    input: EditorialRunFeedbackInput,
  ): Promise<EditorialRunFeedback> {
    await this.ensureSchema();
    const existing = await this.getFeedback(input.runId);
    const timestamp = new Date().toISOString();
    const createdAt = input.createdAt ?? existing?.createdAt ?? timestamp;
    const updatedAt = input.updatedAt ?? timestamp;
    await this.db.prepare(
      `INSERT OR REPLACE INTO editorial_run_feedback
      (run_id, profile_id, account_id, rating, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.runId,
      input.profileId ?? existing?.profileId ?? null,
      input.accountId ?? existing?.accountId ?? null,
      input.rating,
      input.note?.trim() || null,
      createdAt,
      updatedAt,
    ).run();
    return (await this.getFeedback(input.runId))!;
  }

  async deleteFeedback(runId: string): Promise<boolean> {
    await this.ensureSchema();
    const existing = await this.getFeedback(runId);
    if (!existing) return false;
    await this.db.prepare("DELETE FROM editorial_run_feedback WHERE run_id = ?")
      .bind(runId).run();
    return true;
  }

  async listTopicFeedback(options: {
    runId?: string;
    profileId?: string;
    accountId?: string;
    strictAccount?: boolean;
    limit?: number;
  } = {}): Promise<EditorialTopicFeedback[]> {
    return (await this.listTopicFeedbackRows(options)).map(rowToTopicFeedback);
  }

  async saveTopicFeedback(
    input: EditorialTopicFeedbackInput,
  ): Promise<EditorialTopicFeedback> {
    await this.ensureSchema();
    const existing = await this.getTopicFeedback(input.runId, input.topicId);
    const timestamp = new Date().toISOString();
    const createdAt = input.createdAt ?? existing?.createdAt ?? timestamp;
    const updatedAt = input.updatedAt ?? timestamp;
    await this.db.prepare(
      `INSERT OR REPLACE INTO editorial_topic_feedback
      (run_id, topic_id, profile_id, account_id, action, title, reason, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.runId,
      input.topicId,
      input.profileId ?? existing?.profileId ?? null,
      input.accountId ?? existing?.accountId ?? null,
      input.action,
      (input.title?.trim() || existing?.title) ?? null,
      input.reason?.trim() || null,
      createdAt,
      updatedAt,
    ).run();
    return (await this.getTopicFeedback(input.runId, input.topicId))!;
  }

  async deleteTopicFeedback(
    runId: string,
    topicId: string,
  ): Promise<boolean> {
    await this.ensureSchema();
    const existing = await this.getTopicFeedback(runId, topicId);
    if (!existing) return false;
    await this.db.prepare(
      "DELETE FROM editorial_topic_feedback WHERE run_id = ? AND topic_id = ?",
    ).bind(runId, topicId).run();
    return true;
  }

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    await this.ensureRunColumns();
    await this.ensureAccountColumns();
    for (const statement of splitSqlStatements(ARTICLE_WORKFLOW_SCHEMA_SQL)) {
      await this.db.prepare(statement).run();
    }
    await this.ensureRunColumns();
    await this.ensureAccountColumns();
    this.schemaReady = true;
  }

  private async getTopicFeedback(
    runId: string,
    topicId: string,
  ): Promise<EditorialTopicFeedback | null> {
    await this.ensureSchema();
    const row = await this.db.prepare(
      "SELECT * FROM editorial_topic_feedback WHERE run_id = ? AND topic_id = ?",
    ).bind(runId, topicId).first<TopicFeedbackRow>();
    return row ? rowToTopicFeedback(row) : null;
  }

  private async listTopicFeedbackRows(options: {
    runId?: string;
    profileId?: string;
    accountId?: string;
    strictAccount?: boolean;
    limit?: number;
  }): Promise<TopicFeedbackRow[]> {
    await this.ensureSchema();
    const limit = options.limit ?? 30;
    if (options.runId) {
      const result = await this.db.prepare(
        "SELECT * FROM editorial_topic_feedback WHERE run_id = ? ORDER BY updated_at DESC LIMIT ?",
      ).bind(options.runId, limit).all<TopicFeedbackRow>();
      return result.results;
    }
    if (options.accountId && options.strictAccount) {
      if (options.accountId === "default") {
        const result = await this.db.prepare(
          `SELECT * FROM editorial_topic_feedback
          WHERE account_id = ? OR account_id IS NULL
          ORDER BY updated_at DESC
          LIMIT ?`,
        ).bind(options.accountId, limit).all<TopicFeedbackRow>();
        return result.results;
      }
      const result = await this.db.prepare(
        `SELECT * FROM editorial_topic_feedback
        WHERE account_id = ?
        ORDER BY updated_at DESC
        LIMIT ?`,
      ).bind(options.accountId, limit).all<TopicFeedbackRow>();
      return result.results;
    }
    if (options.accountId) {
      const result = await this.db.prepare(
        `SELECT * FROM editorial_topic_feedback
        WHERE account_id = ? OR account_id IS NULL
        ORDER BY CASE WHEN account_id = ? THEN 0 ELSE 1 END, updated_at DESC
        LIMIT ?`,
      ).bind(options.accountId, options.accountId, limit).all<
        TopicFeedbackRow
      >();
      return result.results;
    }
    if (options.profileId) {
      const result = await this.db.prepare(
        "SELECT * FROM editorial_topic_feedback WHERE profile_id = ? OR profile_id IS NULL ORDER BY updated_at DESC LIMIT ?",
      ).bind(options.profileId, limit).all<TopicFeedbackRow>();
      return result.results;
    }
    const result = await this.db.prepare(
      "SELECT * FROM editorial_topic_feedback ORDER BY updated_at DESC LIMIT ?",
    ).bind(limit).all<TopicFeedbackRow>();
    return result.results;
  }

  private async ensureRunColumns(): Promise<void> {
    for (
      const statement of [
        "ALTER TABLE article_runs ADD COLUMN run_kind TEXT NOT NULL DEFAULT 'single'",
        "ALTER TABLE article_runs ADD COLUMN parent_run_id TEXT",
        "ALTER TABLE article_runs ADD COLUMN account_id TEXT",
        "ALTER TABLE article_runs ADD COLUMN profile_id TEXT",
        "CREATE INDEX IF NOT EXISTS idx_article_runs_parent ON article_runs(parent_run_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_article_runs_account ON article_runs(account_id, created_at DESC)",
      ]
    ) {
      try {
        await this.db.prepare(statement).run();
      } catch (error) {
        if (!isIgnorableSchemaError(error)) {
          throw error;
        }
      }
    }
  }

  private async ensureAccountColumns(): Promise<void> {
    for (
      const statement of [
        "ALTER TABLE editorial_article_memory ADD COLUMN account_id TEXT",
        "ALTER TABLE editorial_run_feedback ADD COLUMN account_id TEXT",
        "CREATE INDEX IF NOT EXISTS idx_editorial_article_memory_account_created ON editorial_article_memory(account_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_editorial_run_feedback_account_updated ON editorial_run_feedback(account_id, updated_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_editorial_topic_feedback_account_updated ON editorial_topic_feedback(account_id, updated_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_editorial_topic_feedback_profile_updated ON editorial_topic_feedback(profile_id, updated_at DESC)",
      ]
    ) {
      try {
        await this.db.prepare(statement).run();
      } catch (error) {
        if (!isIgnorableSchemaError(error)) {
          throw error;
        }
      }
    }
  }
}

function isIgnorableSchemaError(error: unknown): boolean {
  const message = String(error);
  return message.includes("duplicate column name") ||
    message.includes("no such table");
}

interface ArticleMemoryRow {
  run_id: string;
  profile_id: string | null;
  account_id: string | null;
  title: string;
  thesis: string | null;
  keywords_json: string;
  topic_titles_json: string;
  source_urls_json: string;
  quality_score: number | null;
  publish_status: string;
  dry_run: number;
  created_at: string;
}

interface SourcePerformanceRow {
  url: string;
  group_name: string;
  runs: number;
  successes: number;
  failures: number;
  empty: number;
  total_articles: number;
  last_status: "succeeded" | "failed" | "empty";
  last_provider: string | null;
  last_error: string | null;
  last_run_id: string | null;
  updated_at: string;
}

interface FeedbackRow {
  run_id: string;
  profile_id: string | null;
  account_id: string | null;
  rating: "good" | "ok" | "bad";
  note: string | null;
  created_at: string;
  updated_at: string;
}

interface TopicFeedbackRow {
  run_id: string;
  topic_id: string;
  profile_id: string | null;
  account_id: string | null;
  action: "lead" | "adopt" | "skip";
  title: string | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

function rowToArticleMemory(row: ArticleMemoryRow): EditorialArticleMemory {
  return {
    runId: row.run_id,
    profileId: row.profile_id ?? undefined,
    accountId: row.account_id ?? undefined,
    title: row.title,
    thesis: row.thesis ?? undefined,
    keywords: parseStringArray(row.keywords_json),
    topicTitles: parseStringArray(row.topic_titles_json),
    sourceUrls: parseStringArray(row.source_urls_json),
    qualityScore: row.quality_score ?? undefined,
    publishStatus: row.publish_status,
    dryRun: Boolean(row.dry_run),
    createdAt: row.created_at,
  };
}

function rowToSourcePerformance(
  row: SourcePerformanceRow,
): SourcePerformanceRecord {
  return {
    url: row.url,
    group: row.group_name,
    runs: Number(row.runs),
    successes: Number(row.successes),
    failures: Number(row.failures),
    empty: Number(row.empty),
    totalArticles: Number(row.total_articles),
    lastStatus: row.last_status,
    lastProvider: row.last_provider ?? undefined,
    lastError: row.last_error ?? undefined,
    lastRunId: row.last_run_id ?? undefined,
    updatedAt: row.updated_at,
  };
}

function rowToFeedback(row: FeedbackRow): EditorialRunFeedback {
  return {
    runId: row.run_id,
    profileId: row.profile_id ?? undefined,
    accountId: row.account_id ?? undefined,
    rating: row.rating,
    note: row.note ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToTopicFeedback(row: TopicFeedbackRow): EditorialTopicFeedback {
  return {
    runId: row.run_id,
    topicId: row.topic_id,
    profileId: row.profile_id ?? undefined,
    accountId: row.account_id ?? undefined,
    action: row.action,
    title: row.title ?? undefined,
    reason: row.reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}
