import type React from "react";
import { useEffect, useState } from "react";
import { Drawer, Group, Stack, Table, Textarea } from "@mantine/core";
import {
  CheckCircle2,
  Edit3,
  Network,
  Play,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { apiJson, checkWeixinAccountRelay } from "../api/client.ts";
import type {
  ArticleRuntimeProfileDetail,
  WeixinAccountInsight,
  WeixinAccountProfile,
  WeixinAccountRelayCheck,
} from "../api/types.ts";
import { Badge, Button, Card, Input, Select } from "../components/ui.tsx";

interface AccountDraft {
  id: string;
  name: string;
  enabled: boolean;
  defaultArticleProfileId: string;
  displayName: string;
  positioning: string;
  audience: string;
  tone: string;
  titleStyle: string;
  forbiddenTopics: string;
  template: string;
  promptProfile: string;
  count: string;
  sourceGroupIds: string;
}

export function AccountsWorkspace(
  { apiKey, accounts, insights, profiles, onReload, onRun }: {
    apiKey: string;
    accounts: WeixinAccountProfile[];
    insights: WeixinAccountInsight[];
    profiles: ArticleRuntimeProfileDetail[];
    onReload: () => Promise<void>;
    onRun: () => void;
  },
) {
  const [editing, setEditing] = useState<WeixinAccountProfile | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<AccountDraft>(() =>
    toDraft(null, profiles)
  );
  const [saving, setSaving] = useState(false);
  const [checkingAccountId, setCheckingAccountId] = useState("");
  const [relayChecks, setRelayChecks] = useState<
    Record<string, WeixinAccountRelayCheck>
  >({});

  useEffect(() => {
    setDraft(toDraft(editing, profiles));
  }, [editing, profiles]);

  const openCreate = () => {
    setEditing(null);
    setDraft(toDraft(null, profiles));
    setCreating(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = JSON.stringify(fromDraft(draft));
      if (creating) {
        await apiJson("/api/config/weixin/accounts", apiKey, {
          method: "POST",
          body,
        });
      } else if (editing) {
        await apiJson(
          `/api/config/weixin/accounts/${encodeURIComponent(editing.id)}`,
          apiKey,
          { method: "PATCH", body },
        );
      }
      setCreating(false);
      setEditing(null);
      await onReload();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (account: WeixinAccountProfile) => {
    if (!confirm(`删除公众号账号「${account.name}」？不会删除部署密钥。`)) {
      return;
    }
    await apiJson(
      `/api/config/weixin/accounts/${encodeURIComponent(account.id)}`,
      apiKey,
      { method: "DELETE" },
    );
    await onReload();
  };

  const checkRelay = async (account: WeixinAccountProfile) => {
    setCheckingAccountId(account.id);
    try {
      const result = await checkWeixinAccountRelay(apiKey, account.id);
      setRelayChecks((current) => ({
        ...current,
        [account.id]: result.check,
      }));
    } finally {
      setCheckingAccountId("");
    }
  };

  const enabledAccounts = accounts.filter((account) => account.enabled);
  const connectedAccounts = accounts.filter((account) =>
    account.relay?.configured
  );
  const positionedAccounts = accounts.filter((account) =>
    textValue(account.brand.positioning) && textValue(account.brand.tone)
  );
  const insightByAccount = new Map(
    insights.map((insight) => [insight.accountId, insight]),
  );
  const accountNameById = new Map(accounts.map((account) => [
    account.id,
    account.name,
  ]));
  const learningActions = insights.flatMap((insight) =>
    insight.learning.recommendedActions.map((action) => ({
      ...action,
      accountId: insight.accountId,
      accountName: accountNameById.get(insight.accountId) ?? insight.accountId,
    }))
  ).slice(0, 5);

  return (
    <div className="grid gap-4">
      <section className="grid gap-3 md:grid-cols-3">
        <AccountMetric
          title="可运行账号"
          value={`${enabledAccounts.length}/${accounts.length}`}
          detail="启用后可参与单账号或矩阵 dry-run"
          icon={<Network className="size-4" />}
        />
        <AccountMetric
          title="微信连接"
          value={`${connectedAccounts.length}/${accounts.length}`}
          detail="relay 可用时才能真实创建草稿"
          icon={<CheckCircle2 className="size-4" />}
        />
        <AccountMetric
          title="风格完整度"
          value={`${positionedAccounts.length}/${accounts.length}`}
          detail="定位与语气越明确，成稿越不像通用 AI 文"
          icon={<ShieldCheck className="size-4" />}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[var(--tp-ink)]">
                账号矩阵
              </h2>
              <p className="tp-muted text-sm">
                每个账号绑定自己的定位、读者、语气和默认文章方案；同一批素材可以生成不同风格的文章产物。
              </p>
            </div>
            <Group gap="xs" wrap="nowrap">
              <Button size="sm" variant="primary" onClick={onRun}>
                <Play className="size-4" />
                矩阵运行
              </Button>
              <Button size="sm" onClick={openCreate}>
                <Plus className="size-4" />
                新增账号
              </Button>
            </Group>
          </div>

          <div className="overflow-x-auto rounded-md border border-[var(--tp-border)]">
            <Table
              striped
              highlightOnHover
              verticalSpacing="sm"
              className="min-w-[1180px]"
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th className="w-[130px]">账号</Table.Th>
                  <Table.Th className="w-[260px]">定位</Table.Th>
                  <Table.Th className="w-[190px]">默认方案</Table.Th>
                  <Table.Th className="w-[280px]">质量复盘</Table.Th>
                  <Table.Th className="w-[230px]">微信连接</Table.Th>
                  <Table.Th className="w-[80px]">状态</Table.Th>
                  <Table.Th className="w-[120px]" />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {accounts.length
                  ? accounts.map((account) => (
                    <Table.Tr key={account.id}>
                      <Table.Td>
                        <div className="font-medium text-[var(--tp-ink)]">
                          {account.name}
                        </div>
                        <div className="tp-muted text-xs">{account.id}</div>
                      </Table.Td>
                      <Table.Td className="max-w-[360px]">
                        <div className="truncate text-sm">
                          {textValue(account.brand.positioning) || "未配置定位"}
                        </div>
                        <div className="tp-muted truncate text-xs">
                          {textValue(account.brand.audience) || "未配置受众"}
                        </div>
                      </Table.Td>
                      <Table.Td className="align-top">
                        <div className="whitespace-nowrap text-sm">
                          {profileName(
                            profiles,
                            account.defaultArticleProfileId,
                          ) ??
                            "默认文章方案"}
                        </div>
                        <div className="tp-muted whitespace-nowrap text-xs">
                          {textValue(account.defaults.template) || "继承模板"} ·
                          {" "}
                          {textValue(account.defaults.promptProfile) ||
                            "继承提示词"}
                        </div>
                        <div className="tp-muted whitespace-nowrap text-xs">
                          来源 {sourceGroupLabel(account)}
                        </div>
                      </Table.Td>
                      <Table.Td className="align-top">
                        <AccountInsightCell
                          insight={insightByAccount.get(account.id)}
                        />
                      </Table.Td>
                      <Table.Td className="align-top">
                        <RelayStatusCell
                          account={account}
                          check={relayChecks[account.id]}
                          checking={checkingAccountId === account.id}
                          onCheck={() => checkRelay(account)}
                        />
                      </Table.Td>
                      <Table.Td className="align-top">
                        <span
                          className={account.enabled
                            ? "text-[#047857]"
                            : "text-[var(--tp-muted)]"}
                        >
                          {account.enabled ? "启用" : "停用"}
                        </span>
                      </Table.Td>
                      <Table.Td className="align-top">
                        <Group justify="flex-end" gap="xs">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setCreating(false);
                              setEditing(account);
                            }}
                          >
                            <Edit3 className="size-3.5" />
                            编辑
                          </Button>
                          <Button
                            size="icon"
                            variant="danger"
                            onClick={() => remove(account)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))
                  : (
                    <Table.Tr>
                      <Table.Td colSpan={7}>
                        <div className="py-8 text-center text-sm text-[var(--tp-muted)]">
                          还没有账号。先新增一个默认公众号，再配置定位和文章方案。
                        </div>
                      </Table.Td>
                    </Table.Tr>
                  )}
              </Table.Tbody>
            </Table>
          </div>
        </Card>

        <div className="grid gap-4">
          <Card>
            <h3 className="text-sm font-semibold text-[var(--tp-ink)]">
              账号如何影响成稿
            </h3>
            <div className="mt-3 grid gap-2">
              <MatrixRule
                title="定位决定选题角度"
                detail="同一条新闻，技术号、产品号和投资号会选择不同切入点。"
              />
              <MatrixRule
                title="语气决定表达方式"
                detail="账号语气会影响标题、开头、转场、结尾和评论口吻。"
              />
              <MatrixRule
                title="方案决定生产参数"
                detail="文章数量、模板、配图、质量门禁仍由文章方案控制。"
              />
            </div>
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-[var(--tp-ink)]">
              账号质量复盘
            </h3>
            <div className="mt-3 grid gap-2">
              {accounts.length
                ? accounts.slice(0, 5).map((account) => (
                  <AccountInsightCard
                    key={account.id}
                    account={account}
                    insight={insightByAccount.get(account.id)}
                  />
                ))
                : (
                  <div className="tp-muted text-sm">
                    运行一次矩阵 dry-run
                    后，这里会出现账号级质量分、反馈和最近文章。
                  </div>
                )}
            </div>
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-[var(--tp-ink)]">
              下一步建议
            </h3>
            <div className="mt-3 grid gap-2">
              {learningActions.length
                ? learningActions.map((action, index) => (
                  <div
                    key={`${action.accountId}-${action.title}-${index}`}
                    className="rounded-md border border-[var(--tp-border)] bg-white px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 truncate text-sm font-medium text-[var(--tp-ink)]">
                        {action.title}
                      </div>
                      <Badge tone={learningTone(action.tone)}>
                        {action.accountName}
                      </Badge>
                    </div>
                    <div className="tp-muted mt-1 text-xs leading-5">
                      {action.detail}
                    </div>
                  </div>
                ))
                : (
                  <div className="tp-muted text-sm leading-6">
                    账号画像、来源、质量和 relay 都处于可用状态。继续用矩阵
                    dry-run 对比不同账号的选题和表达差异。
                  </div>
                )}
            </div>
          </Card>
        </div>
      </div>

      <Drawer
        opened={creating || Boolean(editing)}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={creating ? "新增公众号账号" : "编辑公众号账号"}
        position="right"
        size="lg"
      >
        <Stack gap="sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="tp-muted text-xs font-medium">账号 ID</span>
              <Input
                value={draft.id}
                disabled={!creating}
                onChange={(event) =>
                  setDraft({ ...draft, id: event.currentTarget.value })}
              />
            </label>
            <label className="space-y-1.5">
              <span className="tp-muted text-xs font-medium">展示名称</span>
              <Input
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.currentTarget.value })}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) =>
                setDraft({ ...draft, enabled: event.currentTarget.checked })}
            />
            启用账号
          </label>
          <label className="space-y-1.5">
            <span className="tp-muted text-xs font-medium">默认文章方案</span>
            <Select
              value={draft.defaultArticleProfileId}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  defaultArticleProfileId: event.currentTarget.value,
                })}
            >
              <option value="">使用默认方案</option>
              {profiles.map((item) => (
                <option key={item.profile.id} value={item.profile.id}>
                  {item.profile.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1.5">
            <span className="tp-muted text-xs font-medium">内容来源分组</span>
            <Input
              value={draft.sourceGroupIds}
              placeholder="留空表示使用方案全部来源；例如 default, search, rss"
              onChange={(event) =>
                setDraft({
                  ...draft,
                  sourceGroupIds: event.currentTarget.value,
                })}
            />
            <span className="tp-muted block text-[11px] leading-5">
              用于让账号只消费指定数据源分组，矩阵运行时可减少不同账号之间的选题同质化。
            </span>
          </label>
          <TextareaField
            label="账号定位"
            value={draft.positioning}
            onChange={(value) => setDraft({ ...draft, positioning: value })}
          />
          <TextareaField
            label="目标读者"
            value={draft.audience}
            onChange={(value) => setDraft({ ...draft, audience: value })}
          />
          <TextareaField
            label="语气风格"
            value={draft.tone}
            onChange={(value) => setDraft({ ...draft, tone: value })}
          />
          <TextareaField
            label="标题风格"
            value={draft.titleStyle}
            onChange={(value) => setDraft({ ...draft, titleStyle: value })}
          />
          <TextareaField
            label="禁区主题"
            value={draft.forbiddenTopics}
            onChange={(value) => setDraft({ ...draft, forbiddenTopics: value })}
            placeholder="每行一个，不希望账号触碰的内容方向"
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1.5">
              <span className="tp-muted text-xs font-medium">模板覆盖</span>
              <Input
                value={draft.template}
                placeholder="minimal / dynamic"
                onChange={(event) =>
                  setDraft({ ...draft, template: event.currentTarget.value })}
              />
            </label>
            <label className="space-y-1.5">
              <span className="tp-muted text-xs font-medium">提示词风格</span>
              <Input
                value={draft.promptProfile}
                placeholder="technology / business"
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    promptProfile: event.currentTarget.value,
                  })}
              />
            </label>
            <label className="space-y-1.5">
              <span className="tp-muted text-xs font-medium">文章数</span>
              <Input
                type="number"
                min="1"
                max="50"
                value={draft.count}
                onChange={(event) =>
                  setDraft({ ...draft, count: event.currentTarget.value })}
              />
            </label>
          </div>
          <Group justify="flex-end">
            <Button
              variant="secondary"
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
            >
              取消
            </Button>
            <Button onClick={save} disabled={saving}>
              <Save className="size-4" />
              保存
            </Button>
          </Group>
        </Stack>
      </Drawer>
    </div>
  );
}

function TextareaField(
  { label, value, onChange, placeholder }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  },
) {
  return (
    <label className="space-y-1.5">
      <span className="tp-muted text-xs font-medium">{label}</span>
      <Textarea
        value={value}
        placeholder={placeholder}
        autosize
        minRows={2}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function AccountMetric(
  { title, value, detail, icon }: {
    title: string;
    value: string;
    detail: string;
    icon: React.ReactNode;
  },
) {
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-[var(--tp-subtle)]">
            {title}
          </div>
          <div className="mt-1 text-2xl font-semibold leading-none text-[var(--tp-ink)]">
            {value}
          </div>
          <div className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--tp-muted)]">
            {detail}
          </div>
        </div>
        <div className="tp-icon-tile grid size-8 shrink-0 place-items-center rounded-md">
          {icon}
        </div>
      </div>
    </Card>
  );
}

function MatrixRule({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-md border border-[var(--tp-border)] bg-white px-3 py-2.5">
      <div className="text-sm font-medium text-[var(--tp-ink)]">{title}</div>
      <div className="mt-1 text-xs leading-5 text-[var(--tp-muted)]">
        {detail}
      </div>
    </div>
  );
}

function RelayStatusCell(
  { account, check, checking, onCheck }: {
    account: WeixinAccountProfile;
    check?: WeixinAccountRelayCheck;
    checking: boolean;
    onCheck: () => void;
  },
) {
  const configured = account.relay?.configured === true;
  const persistedCheck = account.relay?.lastCheck;
  const status = check
    ? relayCheckLabel(check.status)
    : persistedCheck?.status
    ? relayCheckLabel(persistedCheck.status)
    : configured
    ? "凭证已配置"
    : "缺少凭证";
  const tone = check
    ? check.ok ? "success" : "danger"
    : persistedCheck
    ? persistedCheck.ok ? "success" : "danger"
    : configured
    ? "info"
    : "danger";
  return (
    <div className="min-w-[180px] space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone}>{status}</Badge>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCheck}
          disabled={checking}
        >
          {checking ? "检测中" : "检测"}
        </Button>
      </div>
      <div className="tp-muted text-xs">
        {check?.message ?? persistedCheck?.message ??
          account.relay?.appIdMasked ?? "无脱敏 appId"}
      </div>
      {account.relay?.lastCheckedAt && !check && (
        <div className="tp-muted text-[11px]">
          上次检测 {formatShortDate(account.relay.lastCheckedAt)}
        </div>
      )}
      {(check?.relayUrl || persistedCheck?.relayUrl) && (
        <div className="tp-muted truncate text-[11px]">
          {check?.relayUrl ?? persistedCheck?.relayUrl}
        </div>
      )}
    </div>
  );
}

function relayCheckLabel(
  status: WeixinAccountRelayCheck["status"] | string,
): string {
  if (status === "ok") return "relay 可用";
  if (status === "relay_unconfigured") return "relay 未配置";
  if (status === "account_unconfigured") return "账号未配置";
  if (status === "ip_not_whitelisted") return "IP 未放行";
  return "检测失败";
}

function AccountInsightCell(
  { insight }: { insight?: WeixinAccountInsight },
) {
  if (!insight || insight.recentArticles.length === 0) {
    return (
      <div>
        <div className="text-sm text-[var(--tp-muted)]">暂无运行记忆</div>
        <div className="tp-muted text-xs">先跑一次 dry-run</div>
      </div>
    );
  }
  return (
    <div>
      <div className="text-sm font-medium text-[var(--tp-ink)]">
        {insight.averageQualityScore !== undefined
          ? `${insight.averageQualityScore} 分`
          : "未评分"}
        <span className="tp-muted ml-2 text-xs">
          {insight.totalRuns} runs
        </span>
      </div>
      <div className="tp-muted max-w-[260px] truncate text-xs">
        {insight.recentArticles[0]?.title ?? "暂无文章"}
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        <Badge
          tone={insight.learning.profileCompleteness.score >= 75
            ? "success"
            : "warning"}
        >
          画像 {insight.learning.profileCompleteness.score}%
        </Badge>
        <Badge tone={trendTone(insight.learning.qualityTrend.direction)}>
          {insight.learning.qualityTrend.label}
        </Badge>
        {insight.topicFeedbackCounts.lead +
                insight.topicFeedbackCounts.adopt +
                insight.topicFeedbackCounts.skip > 0 && (
          <Badge tone="info">
            主题 {insight.topicFeedbackCounts.lead}/
            {insight.topicFeedbackCounts.adopt}/
            {insight.topicFeedbackCounts.skip}
          </Badge>
        )}
      </div>
    </div>
  );
}

function AccountInsightCard(
  { account, insight }: {
    account: WeixinAccountProfile;
    insight?: WeixinAccountInsight;
  },
) {
  const latestArticle = insight?.recentArticles[0];
  return (
    <div className="rounded-md border border-[var(--tp-border)] bg-white px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[var(--tp-ink)]">
            {account.name}
          </div>
          <div className="tp-muted mt-0.5 text-xs">
            {insight?.latestRun
              ? `最近 ${
                formatShortDate(insight.latestRun.createdAt)
              } · ${insight.latestRun.status}`
              : "还没有运行记录"}
          </div>
        </div>
        <div className="shrink-0 rounded-full border border-[var(--tp-border)] px-2 py-0.5 text-xs text-[var(--tp-ink)]">
          {insight?.averageQualityScore !== undefined
            ? `${insight.averageQualityScore}分`
            : "未评分"}
        </div>
      </div>
      <div className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--tp-muted)]">
        {latestArticle?.title ??
          "矩阵 dry-run 后会沉淀最近文章、质量分和反馈。"}
      </div>
      {insight && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-1.5 text-[11px] text-[var(--tp-muted)]">
            <span>好 {insight.feedbackCounts.good}</span>
            <span>一般 {insight.feedbackCounts.ok}</span>
            <span>差 {insight.feedbackCounts.bad}</span>
            <span>
              主题 锁{insight.topicFeedbackCounts.lead}/用
              {insight.topicFeedbackCounts.adopt}/跳
              {insight.topicFeedbackCounts.skip}
            </span>
            <span>画像 {insight.learning.profileCompleteness.score}%</span>
            {insight.latestMatrixRunId && <span>矩阵已跑</span>}
          </div>
          {insight.learning.writingGuidance.length > 0 && (
            <div className="rounded border border-[var(--tp-border)] bg-[var(--tp-surface-soft)] px-2 py-1.5 text-[11px] leading-5 text-[var(--tp-muted)]">
              {insight.learning.writingGuidance[0]}
            </div>
          )}
          {insight.learning.recommendedActions[0] && (
            <div className="flex items-start gap-2 text-[11px] leading-5">
              <Badge
                tone={learningTone(
                  insight.learning.recommendedActions[0].tone,
                )}
              >
                建议
              </Badge>
              <span className="text-[var(--tp-muted)]">
                {insight.learning.recommendedActions[0].title}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function learningTone(tone: "success" | "info" | "warning" | "danger") {
  if (tone === "danger") return "danger";
  if (tone === "warning") return "warning";
  if (tone === "success") return "success";
  return "info";
}

function trendTone(direction: "up" | "down" | "stable" | "unknown") {
  if (direction === "up") return "success";
  if (direction === "down") return "warning";
  if (direction === "stable") return "info";
  return "muted";
}

function formatShortDate(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function toDraft(
  account: WeixinAccountProfile | null,
  profiles: ArticleRuntimeProfileDetail[],
): AccountDraft {
  const brand = account?.brand ?? {};
  const defaults = account?.defaults ?? {};
  const defaultProfileId = account?.defaultArticleProfileId ??
    textValue(defaults.articleProfileId) ??
    profiles.find((item) => item.profile.isDefault)?.profile.id ??
    "";
  return {
    id: account?.id ?? "",
    name: account?.name ?? "",
    enabled: account?.enabled ?? true,
    defaultArticleProfileId: defaultProfileId,
    displayName: textValue(brand.displayName) ?? account?.name ?? "",
    positioning: textValue(brand.positioning) ?? "",
    audience: textValue(brand.audience) ?? "",
    tone: textValue(brand.tone) ?? "",
    titleStyle: textValue(brand.titleStyle) ?? "",
    forbiddenTopics: Array.isArray(brand.forbiddenTopics)
      ? brand.forbiddenTopics.filter((item): item is string =>
        typeof item === "string"
      ).join("\n")
      : "",
    template: textValue(defaults.template) ?? "",
    promptProfile: textValue(defaults.promptProfile) ?? "",
    count: typeof defaults.count === "number" ? String(defaults.count) : "",
    sourceGroupIds: textArrayValue(defaults.sourceGroupIds).join(", "),
  };
}

function fromDraft(draft: AccountDraft) {
  const count = Number(draft.count);
  return {
    id: draft.id.trim(),
    name: draft.name.trim(),
    enabled: draft.enabled,
    defaultArticleProfileId: draft.defaultArticleProfileId || undefined,
    brand: {
      displayName: draft.displayName.trim() || draft.name.trim(),
      positioning: draft.positioning.trim(),
      audience: draft.audience.trim(),
      tone: draft.tone.trim(),
      titleStyle: draft.titleStyle.trim(),
      forbiddenTopics: draft.forbiddenTopics.split(/\n+/).map((item) =>
        item.trim()
      ).filter(Boolean),
    },
    defaults: {
      articleProfileId: draft.defaultArticleProfileId || undefined,
      template: draft.template.trim() || undefined,
      promptProfile: draft.promptProfile.trim() || undefined,
      count: Number.isFinite(count) && count > 0 ? count : undefined,
      sourceGroupIds: parseSourceGroupInput(draft.sourceGroupIds),
    },
  };
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function textArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((
      item,
    ) => item.trim()).filter(Boolean)
    : [];
}

function parseSourceGroupInput(value: string): string[] | undefined {
  const groups = [
    ...new Set(
      value.split(/[\s,，]+/).map((item) => item.trim()).filter(Boolean),
    ),
  ];
  return groups.length ? groups : undefined;
}

function sourceGroupLabel(account: WeixinAccountProfile): string {
  const groups = textArrayValue(account.defaults.sourceGroupIds);
  return groups.length ? groups.join(", ") : "全部";
}

function profileName(
  profiles: ArticleRuntimeProfileDetail[],
  profileId?: string,
) {
  return profiles.find((item) => item.profile.id === profileId)?.profile.name;
}
