/** 从头条列表接口提取的统一文章状态。 */
export interface RemoteArticle {
  articleId: string;
  currentUrl: string;
  status: "draft" | "scheduled" | "published";
}

export function findMatchingDraft(
  value: unknown,
  title: string,
): RemoteArticle | undefined {
  if (!value || typeof value !== "object") return undefined;
  const list = (value as { draft_list?: unknown }).draft_list;
  if (!Array.isArray(list)) return undefined;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const draft = item as Record<string, unknown>;
    if (readString(draft.title) !== title) continue;
    const articleId = firstString(
      draft.draft_id,
      draft.gid,
      draft.pgc_id,
      draft.article_id,
      draft.content_id,
      draft.item_id,
      draft.id,
    );
    if (!articleId) continue;
    return {
      articleId,
      currentUrl: firstString(draft.edit_url, draft.url) ??
        "https://mp.toutiao.com/profile_v4/manage/draft",
      status: "draft",
    };
  }
  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const stringValue = readString(value);
    if (stringValue) return stringValue;
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}
