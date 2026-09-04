export type ArticlePlanFormat =
  | "daily-brief"
  | "deep-analysis"
  | "product-review"
  | "trend-analysis"
  | "tutorial"
  | "interview"
  | "mixed";

export interface ArticlePlanSection {
  id: string;
  title: string;
  intent: string;
  angle: string;
  articleIds: string[];
  keyPoints: string[];
}

export interface ArticleTitleDirection {
  title: string;
  angle: string;
  reason: string;
}

export interface ArticleCoverDirection {
  visualBrief: string;
  textBrief: string;
  mood: string;
}

export interface ArticleBodyImagePlan {
  enabled: boolean;
  placements: Array<{
    sectionId: string;
    purpose: string;
    promptHint: string;
  }>;
}

export interface ArticleRiskNote {
  level: "low" | "medium" | "high";
  issue: string;
  handling: string;
}

export interface ArticlePlan {
  generatedAt: string;
  fallback: boolean;
  error?: string;
  format: ArticlePlanFormat;
  thesis: string;
  targetReader: string;
  summary: string;
  sections: ArticlePlanSection[];
  titleDirections: ArticleTitleDirection[];
  coverDirection: ArticleCoverDirection;
  bodyImagePlan: ArticleBodyImagePlan;
  riskNotes: ArticleRiskNote[];
  sourceArticleIds: string[];
}
