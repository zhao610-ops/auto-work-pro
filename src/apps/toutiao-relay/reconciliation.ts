/** 从头条列表接口提取的统一文章状态。 */
export interface RemoteArticle {
  articleId: string;
  currentUrl: string;
  /** 平台列表直接返回的真实编辑地址；恢复草稿时必须优先使用它。 */
  editUrl?: string;
  /** 平台返回的创建或更新时间，用于同标题草稿的时间窗口匹配。 */
  platformCreatedAt?: string;
  status: "draft" | "scheduled" | "published";
}

export interface ArticleMatchCriteria {
  title: string;
  /** 本地正文的稳定指纹。平台返回正文时必须一致，避免同标题误命中。 */
  contentFingerprint?: string;
  /** 本地任务创建时间；平台返回时间时只接受相邻时间窗口内的候选。 */
  createdAt?: string;
}

const MATCH_WINDOW_MS = 36 * 60 * 60 * 1_000;

/** 生成跨进程可复用的正文指纹，忽略 HTML 格式和普通空白差异。 */
export async function createContentFingerprint(
  content: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeContent(content));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
}

export async function findMatchingDraft(
  value: unknown,
  criteria: ArticleMatchCriteria,
): Promise<RemoteArticle | undefined> {
  if (!value || typeof value !== "object") return undefined;
  const list = (value as { draft_list?: unknown }).draft_list;
  if (!Array.isArray(list)) return undefined;
  return await selectBestMatchingArticle(list, criteria, "draft");
}

/** 在作品管理返回的任意嵌套列表中选择唯一且可信的同标题文章。 */
export async function findMatchingManagedContent(
  value: unknown,
  criteria: ArticleMatchCriteria,
): Promise<RemoteArticle | undefined> {
  return await selectBestMatchingArticle(
    findObjectsWithTitle(value, criteria.title),
    criteria,
    "managed",
  );
}

async function selectBestMatchingArticle(
  values: unknown[],
  criteria: ArticleMatchCriteria,
  source: "draft" | "managed",
): Promise<RemoteArticle | undefined> {
  const candidates: Array<
    { article: RemoteArticle; score: number; distance: number }
  > = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const item = value as Record<string, unknown>;
    if (readString(item.title) !== criteria.title) continue;
    const articleId = source === "draft"
      ? firstString(
        item.draft_id,
        item.gid,
        item.pgc_id,
        item.article_id,
        item.content_id,
        item.item_id,
        item.id,
      )
      : firstString(
        item.article_id,
        item.content_id,
        item.item_id,
        item.group_id,
        item.id,
      );
    if (!articleId) continue;

    const platformCreatedAt = readTimestamp(item);
    const distance = timestampDistance(criteria.createdAt, platformCreatedAt);
    if (distance !== undefined && distance > MATCH_WINDOW_MS) continue;
    const remoteContent = firstString(
      item.content,
      item.content_text,
      item.contentText,
      item.body,
      item.article_content,
      item.articleContent,
    );
    let score = 0;
    if (criteria.contentFingerprint && remoteContent) {
      if (
        await createContentFingerprint(remoteContent) !==
          criteria.contentFingerprint
      ) continue;
      score += 100;
    }
    if (distance !== undefined) score += 10;
    const editUrl = firstString(item.edit_url, item.editUrl);
    candidates.push({
      article: {
        articleId,
        currentUrl: firstString(item.url, editUrl) ??
          (source === "draft"
            ? "https://mp.toutiao.com/profile_v4/manage/draft"
            : "https://mp.toutiao.com/profile_v4/manage/content/all"),
        ...(editUrl ? { editUrl } : {}),
        ...(platformCreatedAt ? { platformCreatedAt } : {}),
        status: source === "draft" ? "draft" : managedStatus(item),
      },
      score,
      distance: distance ?? Number.POSITIVE_INFINITY,
    });
  }
  if (!candidates.length) return undefined;
  candidates.sort((left, right) =>
    right.score - left.score || left.distance - right.distance
  );
  const best = candidates[0];
  const runnerUp = candidates[1];
  // 多条同标题且没有正文、时间等二次证据时，宁可停止恢复，也不能误发另一篇。
  if (
    runnerUp && best.score === runnerUp.score &&
    best.distance === runnerUp.distance
  ) return undefined;
  return best.article;
}

function findObjectsWithTitle(
  value: unknown,
  title: string,
): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => findObjectsWithTitle(item, title));
  }
  const object = value as Record<string, unknown>;
  return [
    ...(readString(object.title) === title ? [object] : []),
    ...Object.values(object).flatMap((item) =>
      findObjectsWithTitle(item, title)
    ),
  ];
}

function managedStatus(
  item: Record<string, unknown>,
): "scheduled" | "published" {
  const statusText = [
    item.status,
    item.status_desc,
    item.publish_status,
    item.publish_status_desc,
    item.display_status,
  ]
    .map((entry) => String(entry ?? "")).join(" ");
  return /定时|schedule/i.test(statusText) ||
      hasFuturePublishTime(item.publish_time ?? item.publishTime)
    ? "scheduled"
    : "published";
}

function readTimestamp(item: Record<string, unknown>): string | undefined {
  for (
    const value of [
      item.create_time,
      item.created_at,
      item.createdAt,
      item.ctime,
      item.update_time,
      item.updated_at,
    ]
  ) {
    const timestamp = parseTimestamp(value);
    if (timestamp !== undefined) return new Date(timestamp).toISOString();
  }
  return undefined;
}

function timestampDistance(left?: string, right?: string): number | undefined {
  if (!left || !right) return undefined;
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime)
    ? Math.abs(leftTime - rightTime)
    : undefined;
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1_000 : value;
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function hasFuturePublishTime(value: unknown): boolean {
  const timestamp = parseTimestamp(value);
  return timestamp !== undefined && timestamp > Date.now();
}

function normalizeContent(value: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    "#39": "'",
    "#x27": "'",
  };
  return value.replaceAll(/<[^>]+>/g, " ")
    .replaceAll(
      /&(amp|lt|gt|quot|#39|#x27);/gi,
      (matched, entity: string) => entities[entity.toLowerCase()] ?? matched,
    )
    .replaceAll(/\s+/g, " ").trim();
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
