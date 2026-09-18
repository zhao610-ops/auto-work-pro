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
  /** 主题级热度；外部数据不可用时为基于多源与时效的估算值。 */
  heat?: number;
  /** 对目标读者的业务可复用价值，综合行动性、证据与相关性。 */
  businessValue?: number;
  /** 不符合证据或落地门槛的主题不能成为当天主线。 */
  eligibleForLead?: boolean;
  eligibilityReason?: string;
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
