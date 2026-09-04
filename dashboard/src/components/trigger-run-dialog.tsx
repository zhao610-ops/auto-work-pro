import { useEffect, useState } from "react";
import { Alert, Group, Modal, Stack, Text } from "@mantine/core";
import { AlertCircle, Loader2 } from "lucide-react";
import type {
  ArticleRuntimeProfileDetail,
  TriggerMatrixRunPayload,
  TriggerRunPayload,
  WeixinAccountProfile,
} from "../api/types.ts";
import { Button, Input, Select } from "./ui.tsx";

export function TriggerRunDialog(
  {
    open,
    initialMode = "single",
    profiles,
    accounts,
    onClose,
    onSubmit,
    onSubmitMatrix,
  }: {
    open: boolean;
    initialMode?: "single" | "matrix";
    profiles: ArticleRuntimeProfileDetail[];
    accounts: WeixinAccountProfile[];
    onClose: () => void;
    onSubmit: (payload: TriggerRunPayload) => Promise<void>;
    onSubmitMatrix: (payload: TriggerMatrixRunPayload) => Promise<void>;
  },
) {
  const [mode, setMode] = useState<"single" | "matrix">("single");
  const [dryRun, setDryRun] = useState(true);
  const [maxArticles, setMaxArticles] = useState("");
  const [sourceType, setSourceType] = useState("all");
  const [profileId, setProfileId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [matrixAccountIds, setMatrixAccountIds] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const enabledAccounts = accounts.filter((account) => account.enabled);
  const effectiveMatrixAccountIds = matrixAccountIds.length > 0
    ? matrixAccountIds
    : enabledAccounts.map((account) => account.id);
  const canSubmit = mode === "matrix"
    ? effectiveMatrixAccountIds.length > 0
    : dryRun || confirmed;

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    if (initialMode === "matrix") {
      setDryRun(true);
      setConfirmed(false);
      setProfileId("");
    }
  }, [initialMode, open]);

  return (
    <Modal
      opened={open}
      onClose={onClose}
      title="触发微信文章工作流"
      centered
      size="lg"
      radius="md"
      overlayProps={{ blur: 4 }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!canSubmit) return;
          setSubmitting(true);
          try {
            const basePayload = {
              maxArticles: Number(maxArticles) || undefined,
              sourceType,
              profileId: profileId || undefined,
            };
            if (mode === "matrix") {
              await onSubmitMatrix({
                ...basePayload,
                dryRun: true,
                accountIds: effectiveMatrixAccountIds,
              });
            } else {
              await onSubmit({
                ...basePayload,
                accountId: accountId || undefined,
                dryRun,
                forcePublish: !dryRun,
              });
            }
            onClose();
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            默认先 dry-run 检查产物。矩阵模式会为每个公众号创建独立子
            run，并默认使用各账号自己的文章方案；只有显式选择文章方案时才会统一覆盖。
          </Text>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="tp-section flex cursor-pointer items-center gap-3 rounded-md border p-3">
              <input
                className="size-4 accent-[#2563eb]"
                type="radio"
                checked={mode === "single"}
                onChange={() => setMode("single")}
              />
              <span>
                <span className="tp-title block text-sm font-medium">
                  单账号运行
                </span>
                <span className="tp-muted block text-xs">
                  适合检查或创建某个账号的草稿。
                </span>
              </span>
            </label>
            <label className="tp-section flex cursor-pointer items-center gap-3 rounded-md border p-3">
              <input
                className="size-4 accent-[#2563eb]"
                type="radio"
                checked={mode === "matrix"}
                onChange={() => {
                  setMode("matrix");
                  setDryRun(true);
                  setConfirmed(false);
                }}
              />
              <span>
                <span className="tp-title block text-sm font-medium">
                  矩阵 dry-run
                </span>
                <span className="tp-muted block text-xs">
                  同批次对多个账号生成风格化产物。
                </span>
              </span>
            </label>
          </div>

          <label className="tp-section flex items-center justify-between gap-3 rounded-md border p-3">
            <span>
              <span className="tp-title block text-sm font-medium">
                Dry-run
              </span>
              <span className="tp-muted block text-xs">
                不上传图片，不创建微信草稿，只生成可预览产物。
              </span>
            </span>
            <input
              className="size-4 accent-[#0f172a]"
              type="checkbox"
              checked={mode === "matrix" ? true : dryRun}
              disabled={mode === "matrix"}
              onChange={(event) => {
                setDryRun(event.currentTarget.checked);
                setConfirmed(false);
              }}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 sm:col-span-2">
              <span className="tp-muted text-xs font-medium">文章方案</span>
              <Select
                value={profileId}
                onChange={(event) => setProfileId(event.currentTarget.value)}
              >
                <option value="">
                  {mode === "matrix"
                    ? "使用每个账号的默认文章方案"
                    : "使用账号/系统默认文章方案"}
                </option>
                {profiles.map((item) => (
                  <option value={item.profile.id} key={item.profile.id}>
                    {item.profile.name}
                  </option>
                ))}
              </Select>
            </label>
            {mode === "single" && (
              <label className="space-y-1 sm:col-span-2">
                <span className="tp-muted text-xs font-medium">公众号账号</span>
                <Select
                  value={accountId}
                  onChange={(event) => setAccountId(event.currentTarget.value)}
                >
                  <option value="">使用方案默认账号</option>
                  {enabledAccounts.map((account) => (
                    <option value={account.id} key={account.id}>
                      {account.name} ({account.id})
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {mode === "matrix" && (
              <div className="space-y-2 sm:col-span-2">
                <span className="tp-muted text-xs font-medium">矩阵账号</span>
                <div className="grid gap-2 sm:grid-cols-2">
                  {enabledAccounts.map((account) => {
                    const checked = effectiveMatrixAccountIds.includes(
                      account.id,
                    );
                    return (
                      <label
                        className="tp-section flex items-start gap-2 rounded-md border p-2.5 text-sm"
                        key={account.id}
                      >
                        <input
                          className="mt-0.5 size-4 accent-[#2563eb]"
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            const next = new Set(effectiveMatrixAccountIds);
                            if (event.currentTarget.checked) {
                              next.add(account.id);
                            } else {
                              next.delete(account.id);
                            }
                            setMatrixAccountIds([...next]);
                          }}
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {account.name}
                          </span>
                          <span className="tp-muted block truncate text-xs">
                            {account.id}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {enabledAccounts.length === 0 && (
                  <Text size="xs" c="red">
                    还没有启用的公众号账号，请先到账号矩阵页面配置。
                  </Text>
                )}
              </div>
            )}
            <label className="space-y-1">
              <span className="tp-muted text-xs font-medium">文章数量</span>
              <Input
                type="number"
                min="1"
                max="30"
                placeholder="使用方案默认"
                value={maxArticles}
                onChange={(event) => setMaxArticles(event.currentTarget.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="tp-muted text-xs font-medium">数据源</span>
              <Select
                value={sourceType}
                onChange={(event) => setSourceType(event.currentTarget.value)}
              >
                <option value="all">全部</option>
                <option value="firecrawl">网页</option>
                <option value="jina">Jina Reader</option>
                <option value="jina-search">Jina Search</option>
                <option value="brave-search">Brave Search</option>
                <option value="tavily-search">Tavily</option>
                <option value="exa-search">Exa</option>
                <option value="serper-search">Serper</option>
                <option value="newsapi">NewsAPI</option>
                <option value="gdelt">GDELT</option>
                <option value="hackernews">Hacker News</option>
                <option value="arxiv">arXiv</option>
                <option value="twitter">Twitter/X</option>
                <option value="rss">RSS</option>
              </Select>
            </label>
          </div>

          {mode === "matrix" && (
            <Alert color="blue" icon={<AlertCircle className="size-4" />}>
              矩阵模式会创建父批次和多个子 run；为了避免误发，当前只支持
              dry-run。未选择文章方案时，每个账号会使用自己的默认文章方案和账号覆盖参数。
            </Alert>
          )}

          {mode === "single" && !dryRun && (
            <Alert color="orange" icon={<AlertCircle className="size-4" />}>
              <label className="flex items-start gap-2 text-sm">
                <input
                  className="mt-1 size-4 accent-[#2563eb]"
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) =>
                    setConfirmed(event.currentTarget.checked)}
                />
                我确认要执行真实发布流程，并创建微信公众号草稿。
              </label>
            </Alert>
          )}

          <Group justify="flex-end" gap="xs">
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button
              type="submit"
              variant={dryRun ? "primary" : "danger"}
              disabled={!canSubmit || submitting}
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {mode === "matrix"
                ? "开始矩阵 dry-run"
                : dryRun
                ? "开始 dry-run"
                : "确认创建草稿"}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
