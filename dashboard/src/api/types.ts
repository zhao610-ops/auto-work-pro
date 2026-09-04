export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type StepStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

export interface ArtifactRef {
  store: string;
  key: string;
  contentType: string;
  label?: string;
  size?: number;
  checksum?: string;
}

export interface ArticleRunRecord {
  runId: string;
  runKind?: "single" | "matrix-parent" | "matrix-child";
  parentRunId?: string;
  accountId?: string;
  profileId?: string;
  mode: string;
  status: RunStatus;
  dryRun: boolean;
  trigger: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  summary?: string;
  error?: string;
  artifacts: ArtifactRef[];
}

export interface ArticleRunStepRecord {
  runId: string;
  name: string;
  status: StepStatus;
  attempt: number;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  inputArtifacts?: ArtifactRef[];
  outputArtifacts?: ArtifactRef[];
  error?: string;
}

export interface ArticleRunDetail extends ArticleRunRecord {
  steps: ArticleRunStepRecord[];
}

export interface HealthResponse {
  ok: boolean;
  mode: string;
  timestamp: string;
  checks: Record<string, { ok: boolean; detail: string }>;
}

export interface ConfigSummary {
  mode: string;
  article: {
    dryRunDefault: boolean;
    count: number;
    sourcesCount: number;
    renderer: {
      template: string;
      promptProfile: string;
    };
    publisher: {
      provider: string;
      accountId?: string;
    };
    cover: {
      enabled: boolean;
      provider: string;
      model: string;
    };
    bodyImages: {
      mode: string;
      provider: string;
      model: string;
      count: number;
      size: string;
    };
    deduplication: {
      enabled: boolean;
      embeddingProvider: string;
      vectorStore: string;
    };
    notifications: {
      channels: string[];
    };
    qualityGate: {
      enabled: boolean;
      minScore: number;
      blockOnHighFactIssue: boolean;
      forcePublish: boolean;
      allowForcePublish: boolean;
      maxRevisionRounds: number;
    };
  };
  storage: {
    artifacts: string;
    runState: string;
    runtimeConfig: string;
    vector: string;
  };
  fetchGroups: string[];
  providersConfigured: Record<string, boolean>;
  observability: {
    enabled: boolean;
    sinks: string[];
  };
}

export interface CapabilityProfile {
  id: string;
  kind: string;
  name: string;
  enabled: boolean;
  provider: string;
  config: Record<string, unknown>;
  version: number;
  isDefault: boolean;
}

export interface RuntimeFeatureProfile {
  id: string;
  featureKey: string;
  name: string;
  enabled: boolean;
  isDefault: boolean;
  config: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeArticleSource {
  id: string;
  profileId: string;
  raw: string;
  url: string;
  group: string;
  enabled: boolean;
  position: number;
}

export interface RuntimeSchedule {
  id: string;
  featureKey: string;
  profileId: string;
  name: string;
  enabled: boolean;
  cron: string;
  timezone: string;
  dryRun: boolean;
}

export interface ArticleRuntimeProfileDetail {
  profile: RuntimeFeatureProfile;
  article: Record<string, unknown>;
  sources: RuntimeArticleSource[];
  fetchGroups: Record<string, string[]>;
  schedule: RuntimeSchedule | null;
}

export interface WeixinAccountProfile {
  id: string;
  name: string;
  enabled: boolean;
  defaultArticleProfileId?: string;
  brand: Record<string, unknown>;
  defaults: Record<string, unknown>;
  ops?: Record<string, unknown>;
  relay?: {
    configured: boolean;
    defaultConfigured?: boolean;
    appIdMasked?: string;
    lastCheckedAt?: string;
    lastCheck?: {
      checkedAt?: string;
      ok?: boolean;
      status?: string;
      message?: string;
      relayUrl?: string;
      appIdMasked?: string;
    };
  };
  createdAt: string;
  updatedAt: string;
}

export interface WeixinAccountRelayCheck {
  accountId: string;
  ok: boolean;
  status:
    | "ok"
    | "relay_unconfigured"
    | "account_unconfigured"
    | "ip_not_whitelisted"
    | "failed";
  checkedAt: string;
  relayConfigured: boolean;
  accountConfigured: boolean;
  appIdMasked?: string;
  relayUrl?: string;
  result?: string | boolean;
  message: string;
}

export interface WeixinAccountInsight {
  accountId: string;
  totalRuns: number;
  latestRun?: {
    runId: string;
    status: RunStatus;
    dryRun: boolean;
    createdAt: string;
    finishedAt?: string;
  };
  latestMatrixRunId?: string;
  averageQualityScore?: number;
  recentArticles: Array<{
    runId: string;
    title: string;
    qualityScore?: number;
    publishStatus: string;
    dryRun: boolean;
    createdAt: string;
  }>;
  publishStatusCounts: Record<string, number>;
  feedbackCounts: Record<EditorialFeedbackRating, number>;
  topicFeedbackCounts: Record<EditorialTopicFeedbackAction, number>;
  latestFeedback?: {
    runId: string;
    rating: EditorialFeedbackRating;
    note?: string;
    updatedAt: string;
  };
  latestTopicFeedback?: {
    runId: string;
    topicId: string;
    action: EditorialTopicFeedbackAction;
    title?: string;
    reason?: string;
    updatedAt: string;
  };
  learning: {
    profileCompleteness: {
      score: number;
      missingFields: string[];
      presentFields: string[];
    };
    qualityTrend: {
      direction: "up" | "down" | "stable" | "unknown";
      label: string;
      delta?: number;
      recentAverage?: number;
      previousAverage?: number;
    };
    writingGuidance: string[];
    riskSignals: Array<{
      type:
        | "profile"
        | "quality"
        | "feedback"
        | "topic"
        | "source"
        | "publish";
      tone: "success" | "info" | "warning" | "danger";
      title: string;
      detail: string;
      evidence?: string;
    }>;
    recommendedActions: Array<{
      type:
        | "profile"
        | "quality"
        | "feedback"
        | "topic"
        | "source"
        | "publish";
      tone: "success" | "info" | "warning" | "danger";
      title: string;
      detail: string;
      evidence?: string;
    }>;
  };
}

export interface AccountLearningSnapshot {
  generatedAt: string;
  accountId?: string;
  profileId?: string;
  memoryScope: "account-strict" | "mixed-or-global";
  profile: {
    completenessScore: number;
    presentFields: string[];
    missingFields: string[];
    positioning?: string;
    audience?: string;
    tone?: string;
    titleStyle?: string;
  };
  feedback: {
    counts: Record<EditorialFeedbackRating, number>;
    latestGood?: string;
    latestBad?: string;
  };
  topicFeedback: {
    counts: Record<EditorialTopicFeedbackAction, number>;
    lead: string[];
    adopt: string[];
    skip: string[];
  };
  recentArticles: Array<{
    title: string;
    qualityScore?: number;
    publishStatus: string;
    createdAt: string;
  }>;
  sourceSignals: Array<{
    url: string;
    group: string;
    successRate: number;
    totalArticles: number;
    lastStatus: string;
  }>;
  appliedGuidance: string[];
  deterministicRules: string[];
}

export interface SourceDraft {
  raw: string;
  url: string;
  group: string;
  enabled: boolean;
}

export interface FetchGroupDraft {
  name: string;
  providers: string[];
}

export interface ArticleFormDraft {
  count: string;
  dryRun: boolean;
  template: string;
  promptProfile: string;
  llmProfileId: string;
  publisherProvider: string;
  publisherAccountId: string;
  coverEnabled: boolean;
  coverImageProfileId: string;
  coverModel: string;
  bodyImagesMode: string;
  bodyImageProfileId: string;
  bodyImageCount: string;
  bodyImageSize: string;
  dedupEnabled: boolean;
  embeddingProfileId: string;
  vectorStore: string;
  notificationProfileId: string;
  qualityGateEnabled: boolean;
  qualityGateMinScore: string;
  qualityGateBlockOnHighFactIssue: boolean;
  qualityGateForcePublish: boolean;
  qualityGateAllowForcePublish: boolean;
  qualityGateMaxRevisionRounds: string;
}

export interface CapabilityFormDraft {
  id: string;
  kind: string;
  name: string;
  enabled: boolean;
  provider: string;
  model: string;
  count: string;
  size: string;
  channels: string[];
}

export type TopicRecommendation = "lead" | "brief" | "skip" | "watch";

export interface TopicCluster {
  id: string;
  title: string;
  summary: string;
  keywords: string[];
  articleIds: string[];
  primaryArticleId: string;
  sourceCount: number;
  freshness: number;
  confidence: number;
}

export interface TopicScore {
  topicId: string;
  novelty: number;
  relevance: number;
  impact: number;
  evidence: number;
  actionability: number;
  saturation: number;
  risk: number;
  finalScore: number;
  reason: string;
  recommendedUse: TopicRecommendation;
}

export interface EditorialTopicReport {
  generatedAt: string;
  fallback: boolean;
  error?: string;
  clusters: TopicCluster[];
  scores: TopicScore[];
}

export interface EditorialDecision {
  generatedAt: string;
  fallback: boolean;
  error?: string;
  leadTopicId: string;
  leadTopicTitle: string;
  decisionSummary: string;
  whyThisNow: string[];
  selectedTopics: Array<{
    topicId: string;
    role: "lead" | "supporting" | "watch";
    reason: string;
  }>;
  skippedTopics: Array<{
    topicId: string;
    reason: string;
  }>;
  duplicationRisk: {
    level: "low" | "medium" | "high";
    reason: string;
    avoidAngles: string[];
  };
  sourceJudgements: Array<{
    url: string;
    role: "primary" | "supporting" | "reference-only" | "avoid";
    reason: string;
  }>;
  recommendedFormat: string;
  writingDirectives: string[];
  titleWarnings: string[];
}

export interface SourceHealthFailure {
  provider: string;
  message: string;
}

export interface SourceHealthRecord {
  raw: string;
  url: string;
  group: string;
  providers: string[];
  status: "succeeded" | "failed" | "empty";
  selectedProvider?: string;
  articleCount: number;
  durationMs: number;
  failures: SourceHealthFailure[];
}

export interface SourceHealthReport {
  generatedAt: string;
  totalSources: number;
  succeeded: number;
  failed: number;
  empty: number;
  totalArticles: number;
  records: SourceHealthRecord[];
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
export type EditorialTopicFeedbackAction = "lead" | "adopt" | "skip";

export interface EditorialRunFeedback {
  runId: string;
  profileId?: string;
  accountId?: string;
  rating: EditorialFeedbackRating;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EditorialTopicFeedback {
  runId: string;
  topicId: string;
  profileId?: string;
  accountId?: string;
  action: EditorialTopicFeedbackAction;
  title?: string;
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EditorialMemoryContext {
  recentArticles: Array<{
    accountId?: string;
    title: string;
    thesis?: string;
    qualityScore?: number;
    publishStatus: string;
    createdAt: string;
  }>;
  sourcePerformance: SourcePerformanceRecord[];
  recentFeedback: EditorialRunFeedback[];
  recentTopicFeedback: EditorialTopicFeedback[];
}

export interface ArticlePlanSection {
  id: string;
  title: string;
  intent: string;
  angle: string;
  articleIds: string[];
  keyPoints: string[];
}

export interface ArticlePlan {
  generatedAt: string;
  fallback: boolean;
  error?: string;
  format: string;
  thesis: string;
  targetReader: string;
  summary: string;
  sections: ArticlePlanSection[];
  titleDirections: Array<{
    title: string;
    angle: string;
    reason: string;
  }>;
  coverDirection: {
    visualBrief: string;
    textBrief: string;
    mood: string;
  };
  bodyImagePlan: {
    enabled: boolean;
    placements: Array<{
      sectionId: string;
      purpose: string;
      promptHint: string;
    }>;
  };
  riskNotes: Array<{
    level: "low" | "medium" | "high";
    issue: string;
    handling: string;
  }>;
  sourceArticleIds: string[];
}

export interface ArticleQualityReview {
  generatedAt: string;
  fallback: boolean;
  error?: string;
  overallScore: number;
  allowPublish: boolean;
  recommendedAction: string;
  summary: string;
  dimensionScores: Record<string, number>;
  issues: Array<{
    id: string;
    category: string;
    severity: "low" | "medium" | "high" | "blocker";
    message: string;
    evidence?: string;
    suggestion: string;
    autoFixable: boolean;
  }>;
  repairSuggestions: string[];
}

export interface PublishArtifactResult {
  publishId: string;
  status: string;
  platform: string;
  url?: string;
  reason?: string;
}

export interface ApiErrorPayload {
  error?: string | { message?: string; data?: { error?: string } };
}

export interface TriggerRunPayload {
  profileId?: string;
  accountId?: string;
  dryRun?: boolean;
  forcePublish?: boolean;
  sourceType?: string;
  maxArticles?: number;
}

export interface TriggerMatrixRunPayload {
  profileId?: string;
  accountIds: string[];
  dryRun?: boolean;
  sourceType?: string;
  maxArticles?: number;
}
