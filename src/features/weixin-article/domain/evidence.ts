export type EvidenceSourceType =
  | "official"
  | "primary"
  | "media"
  | "community"
  | "background";

export interface EvidenceItem {
  id: string;
  title: string;
  url: string;
  provider: string;
  sourceType: EvidenceSourceType;
  summary: string;
  supports: string[];
  confidence: "high" | "medium" | "low";
}

export interface EvidencePack {
  topic: string;
  generatedAt: string;
  queries: string[];
  items: EvidenceItem[];
  gaps: string[];
  skippedReason?: string;
}
