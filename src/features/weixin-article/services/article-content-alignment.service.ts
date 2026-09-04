import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { EditorialDecision } from "@src/features/weixin-article/domain/editorial-decision.ts";
import type {
  EvidenceItem,
  EvidencePack,
} from "@src/features/weixin-article/domain/evidence.ts";

export interface AlignArticleContentsInput {
  processedContents: ScrapedContent[];
  evidencePack?: EvidencePack;
  editorialDecision?: EditorialDecision;
  maxEvidenceItems?: number;
}

export function alignArticleContentsForPlan(
  input: AlignArticleContentsInput,
): ScrapedContent[] {
  const processedContents = input.processedContents;
  const evidenceItems = selectEvidenceItems(input);
  if (!evidenceItems.length) return processedContents;

  const seenUrls = new Set(
    processedContents.map((item) => normalizeUrl(item.url)),
  );
  const evidenceContents = evidenceItems
    .filter((item) => {
      const normalizedUrl = normalizeUrl(item.url);
      if (!normalizedUrl || seenUrls.has(normalizedUrl)) return false;
      seenUrls.add(normalizedUrl);
      return true;
    })
    .map((item) => evidenceToScrapedContent(item, input.evidencePack));

  const primaryEvidence = evidenceContents.filter((content) =>
    content.metadata.evidenceSourceType === "official" ||
    content.metadata.evidenceSourceType === "primary"
  );
  const supportingEvidence = evidenceContents.filter((content) =>
    !primaryEvidence.includes(content)
  );

  return [...primaryEvidence, ...processedContents, ...supportingEvidence];
}

function selectEvidenceItems(
  input: AlignArticleContentsInput,
): EvidenceItem[] {
  const pack = input.evidencePack;
  if (!pack?.items.length) return [];

  const maxEvidenceItems = Math.max(0, input.maxEvidenceItems ?? 3);
  if (maxEvidenceItems === 0) return [];

  const leadSignals = [
    input.editorialDecision?.leadTopicTitle,
    ...((input.editorialDecision?.selectedTopics ?? [])
      .filter((topic) => topic.role === "lead" || topic.role === "supporting")
      .map((topic) => topic.reason)),
    pack.topic,
  ].flatMap(tokenizeSignal);

  const scored = pack.items
    .map((item) => ({ item, score: scoreEvidenceItem(item, leadSignals) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score);

  return scored.slice(0, maxEvidenceItems).map(({ item }) => item);
}

function scoreEvidenceItem(
  item: EvidenceItem,
  leadSignals: string[],
): number {
  const text = tokenizeSignal([
    item.title,
    item.summary,
    ...item.supports,
  ].join(" "));
  const overlap = leadSignals.filter((signal) => text.includes(signal)).length;
  const directlySupports = item.supports.some((support) => {
    const supportText = tokenizeSignal(support);
    return supportText.some((token) => leadSignals.includes(token));
  });
  if (overlap === 0 && !directlySupports) return 0;

  let score = 0;
  if (item.sourceType === "official" || item.sourceType === "primary") {
    score += 4;
  }
  if (item.confidence === "high") score += 3;
  if (item.confidence === "medium") score += 1;

  score += overlap * 2;

  if (directlySupports) score += 4;

  return score;
}

function evidenceToScrapedContent(
  item: EvidenceItem,
  evidencePack?: EvidencePack,
): ScrapedContent {
  const content = [
    item.summary,
    item.supports.length ? `支持关系：${item.supports.join("；")}` : undefined,
    `来源类型：${item.sourceType}；可信度：${item.confidence}`,
  ].filter(Boolean).join("<next_paragraph />");
  return {
    id: `evidence_${item.id}`,
    title: item.title,
    content,
    url: item.url,
    publishDate: evidencePack?.generatedAt ?? new Date().toISOString(),
    media: [],
    metadata: {
      source: "evidence-pack",
      provider: item.provider,
      evidenceSourceType: item.sourceType,
      confidence: item.confidence,
      supports: item.supports,
      score: item.confidence === "high" ? 90 : 80,
      wordCount: content.length,
      readTime: Math.max(1, Math.ceil(content.length / 275)),
      keywords: tokenizeSignal(`${item.title} ${evidencePack?.topic ?? ""}`)
        .slice(0, 8),
    },
  };
}

function normalizeUrl(url: string | undefined): string {
  return (url ?? "").trim().replace(/\/+$/, "");
}

function tokenizeSignal(value: string | undefined): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
        .filter(isDistinctiveSignalToken),
    ),
  ];
}

function isDistinctiveSignalToken(token: string): boolean {
  return !genericSignalTokens.has(token);
}

const genericSignalTokens = new Set([
  "ai",
  "api",
  "www",
  "com",
  "http",
  "https",
  "news",
  "blog",
  "official",
  "announcement",
  "update",
  "updates",
  "model",
  "models",
  "product",
  "products",
  "company",
  "companies",
  "enterprise",
  "enterprises",
  "technology",
  "technologies",
  "anthropic",
  "openai",
  "google",
  "microsoft",
  "meta",
  "nvidia",
  "amazon",
  "发布",
  "更新",
  "官方",
  "企业",
  "模型",
  "技术",
  "产品",
]);
