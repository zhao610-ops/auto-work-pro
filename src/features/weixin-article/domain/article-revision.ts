export type ArticleRevisionField = "title" | "html";

export interface ArticleRevisionChange {
  issueId: string;
  field: ArticleRevisionField;
  before: string;
  after: string;
  reason: string;
}

export interface ArticleRevisionResult {
  generatedAt: string;
  round: number;
  applied: boolean;
  changedFields: ArticleRevisionField[];
  title: string;
  html: string;
  changes: ArticleRevisionChange[];
  skippedIssueIds: string[];
  notes?: string;
  fallback: boolean;
  error?: string;
}
