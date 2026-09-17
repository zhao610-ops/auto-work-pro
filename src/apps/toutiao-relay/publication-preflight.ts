import { ToutiaoRelayError } from "./errors.ts";
import type { ToutiaoScheduleRequest } from "./types.ts";

const MIN_TOUTIAO_ARTICLE_TEXT_LENGTH = 300;

/** 正式定时发布前的本地硬性校验，必须在浏览器写入正文前完成。 */
export function assertScheduleCoverProvided(
  request: ToutiaoScheduleRequest,
): void {
  if (request.coverImagePath?.trim() || request.coverImageUrl?.trim()) return;
  throw new ToutiaoRelayError(
    "COVER_NOT_FOUND",
    "今日头条正式定时发布必须提供原创封面；请先生成或上传 coverImagePath。",
  );
}

/** 避免正文过短导致头条将“定时发布”按钮置灰，却被误报为选择器失效。 */
export function assertScheduleContentLength(
  request: ToutiaoScheduleRequest,
): void {
  const text = (request.contentHtml ?? request.contentText ?? "")
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/\s+/g, "")
    .replaceAll(/&(?:amp|lt|gt|quot);/g, "")
    .trim();
  if (text.length >= MIN_TOUTIAO_ARTICLE_TEXT_LENGTH) return;
  throw new ToutiaoRelayError(
    "CONTENT_INVALID",
    `今日头条正式文章正文至少需要 ${MIN_TOUTIAO_ARTICLE_TEXT_LENGTH} 个有效字符，当前仅 ${text.length} 个。`,
  );
}
