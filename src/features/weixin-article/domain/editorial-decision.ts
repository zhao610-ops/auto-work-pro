import type { ArticlePlanFormat } from "@src/features/weixin-article/domain/article-plan.ts";

export interface EditorialDecisionSelectedTopic {
  topicId: string;
  role: "lead" | "supporting" | "watch";
  reason: string;
}

export interface EditorialDecisionSkippedTopic {
  topicId: string;
  reason: string;
}

export interface EditorialDecisionSourceJudgement {
  url: string;
  role: "primary" | "supporting" | "reference-only" | "avoid";
  reason: string;
}

export interface EditorialDecision {
  generatedAt: string;
  fallback: boolean;
  error?: string;
  leadTopicId: string;
  leadTopicTitle: string;
  decisionSummary: string;
  whyThisNow: string[];
  selectedTopics: EditorialDecisionSelectedTopic[];
  skippedTopics: EditorialDecisionSkippedTopic[];
  duplicationRisk: {
    level: "low" | "medium" | "high";
    reason: string;
    avoidAngles: string[];
  };
  sourceJudgements: EditorialDecisionSourceJudgement[];
  recommendedFormat: ArticlePlanFormat;
  writingDirectives: string[];
  titleWarnings: string[];
}
