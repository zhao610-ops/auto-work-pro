export type QualityIssueCategory =
  | "fact"
  | "title"
  | "structure"
  | "tone"
  | "html"
  | "image"
  | "risk";

export type QualityIssueSeverity = "low" | "medium" | "high" | "blocker";

export type QualityReviewAction =
  | "publish"
  | "dry-run-only"
  | "revise"
  | "block";

export interface QualityDimensionScores {
  factConsistency: number;
  titleQuality: number;
  structureQuality: number;
  expressionQuality: number;
  htmlCompliance: number;
  imageRelevance: number;
  riskHandling: number;
}

export interface QualityIssue {
  id: string;
  category: QualityIssueCategory;
  severity: QualityIssueSeverity;
  message: string;
  evidence?: string;
  suggestion: string;
  autoFixable: boolean;
}

export interface ArticleQualityReview {
  generatedAt: string;
  fallback: boolean;
  error?: string;
  overallScore: number;
  allowPublish: boolean;
  recommendedAction: QualityReviewAction;
  summary: string;
  dimensionScores: QualityDimensionScores;
  issues: QualityIssue[];
  repairSuggestions: string[];
}
