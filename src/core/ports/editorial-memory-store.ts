export interface EditorialArticleMemoryInput {
  runId: string;
  profileId?: string;
  accountId?: string;
  title: string;
  thesis?: string;
  keywords: string[];
  topicTitles: string[];
  sourceUrls: string[];
  qualityScore?: number;
  publishStatus: string;
  dryRun: boolean;
  createdAt?: string;
}

export interface EditorialArticleMemory extends EditorialArticleMemoryInput {
  createdAt: string;
}

export interface SourcePerformanceRecord {
  url: string;
  group: string;
  runs: number;
  successes: number;
  failures: number;
  empty: number;
  totalArticles: number;
  lastStatus: "succeeded" | "failed" | "empty";
  lastProvider?: string;
  lastError?: string;
  lastRunId?: string;
  updatedAt: string;
}

export type EditorialFeedbackRating = "good" | "ok" | "bad";

export interface EditorialRunFeedbackInput {
  runId: string;
  profileId?: string;
  accountId?: string;
  rating: EditorialFeedbackRating;
  note?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface EditorialRunFeedback extends EditorialRunFeedbackInput {
  createdAt: string;
  updatedAt: string;
}

export type EditorialTopicFeedbackAction = "lead" | "adopt" | "skip";

export interface EditorialTopicFeedbackInput {
  runId: string;
  topicId: string;
  profileId?: string;
  accountId?: string;
  action: EditorialTopicFeedbackAction;
  title?: string;
  reason?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface EditorialTopicFeedback extends EditorialTopicFeedbackInput {
  createdAt: string;
  updatedAt: string;
}

export interface EditorialSourceHealthFailure {
  provider: string;
  message: string;
}

export interface EditorialSourceHealthRecord {
  url: string;
  group: string;
  status: "succeeded" | "failed" | "empty";
  selectedProvider?: string;
  articleCount: number;
  failures: EditorialSourceHealthFailure[];
}

export interface EditorialSourceHealthReport {
  generatedAt: string;
  records: EditorialSourceHealthRecord[];
}

export interface EditorialMemoryContext {
  recentArticles: EditorialArticleMemory[];
  sourcePerformance: SourcePerformanceRecord[];
  recentFeedback: EditorialRunFeedback[];
  recentTopicFeedback: EditorialTopicFeedback[];
}

export interface EditorialMemoryStore {
  getContext(options?: {
    profileId?: string;
    accountId?: string;
    strictAccount?: boolean;
    recentLimit?: number;
    sourceLimit?: number;
  }): Promise<EditorialMemoryContext>;

  recordArticle(input: EditorialArticleMemoryInput): Promise<void>;

  recordSourceHealth(
    runId: string,
    report: EditorialSourceHealthReport,
  ): Promise<void>;

  getFeedback(runId: string): Promise<EditorialRunFeedback | null>;

  saveFeedback(input: EditorialRunFeedbackInput): Promise<EditorialRunFeedback>;

  deleteFeedback(runId: string): Promise<boolean>;

  listTopicFeedback(options?: {
    runId?: string;
    profileId?: string;
    accountId?: string;
    strictAccount?: boolean;
    limit?: number;
  }): Promise<EditorialTopicFeedback[]>;

  saveTopicFeedback(
    input: EditorialTopicFeedbackInput,
  ): Promise<EditorialTopicFeedback>;

  deleteTopicFeedback(runId: string, topicId: string): Promise<boolean>;
}

export class NoopEditorialMemoryStore implements EditorialMemoryStore {
  getContext(): Promise<EditorialMemoryContext> {
    return Promise.resolve({
      recentArticles: [],
      sourcePerformance: [],
      recentFeedback: [],
      recentTopicFeedback: [],
    });
  }

  recordArticle(): Promise<void> {
    return Promise.resolve();
  }

  recordSourceHealth(): Promise<void> {
    return Promise.resolve();
  }

  getFeedback(): Promise<EditorialRunFeedback | null> {
    return Promise.resolve(null);
  }

  saveFeedback(
    input: EditorialRunFeedbackInput,
  ): Promise<EditorialRunFeedback> {
    const timestamp = new Date().toISOString();
    return Promise.resolve({
      ...input,
      createdAt: input.createdAt ?? timestamp,
      updatedAt: input.updatedAt ?? timestamp,
    });
  }

  deleteFeedback(): Promise<boolean> {
    return Promise.resolve(false);
  }

  listTopicFeedback(): Promise<EditorialTopicFeedback[]> {
    return Promise.resolve([]);
  }

  saveTopicFeedback(
    input: EditorialTopicFeedbackInput,
  ): Promise<EditorialTopicFeedback> {
    const timestamp = new Date().toISOString();
    return Promise.resolve({
      ...input,
      createdAt: input.createdAt ?? timestamp,
      updatedAt: input.updatedAt ?? timestamp,
    });
  }

  deleteTopicFeedback(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
