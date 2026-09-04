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
