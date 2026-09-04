import type { JsonObject } from "@src/core/ports/runtime-config-store.ts";

export function formatAccountBrandGuide(
  accountBrand?: JsonObject | null,
): string {
  if (!accountBrand) return "";
  const lines = [
    ["账号名称", textValue(accountBrand.displayName)],
    ["账号定位", textValue(accountBrand.positioning)],
    ["目标读者", textValue(accountBrand.audience)],
    ["语气风格", textValue(accountBrand.tone)],
    ["标题偏好", textValue(accountBrand.titleStyle)],
  ].flatMap(([label, value]) => value ? [`- ${label}：${value}`] : []);

  const forbiddenTopics = Array.isArray(accountBrand.forbiddenTopics)
    ? accountBrand.forbiddenTopics
      .filter((item): item is string =>
        typeof item === "string" && !!item.trim()
      )
      .map((item) => item.trim())
    : [];
  if (forbiddenTopics.length) {
    lines.push(`- 禁区主题：${forbiddenTopics.join("；")}`);
  }

  return lines.length
    ? `\n账号运营约束（优先级高于通用风格，但不得新增事实）：\n${
      lines.join("\n")
    }\n`
    : "";
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
