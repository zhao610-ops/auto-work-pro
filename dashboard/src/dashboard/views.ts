export type DashboardView =
  | "home"
  | "trend"
  | "accounts"
  | "sources"
  | "quality"
  | "runs"
  | "artifacts"
  | "settings";

export const VIEW_META: Record<
  DashboardView,
  { title: string; description: string }
> = {
  home: {
    title: "发布中心",
    description: "判断今天是否适合发、下一步该做什么、风险在哪里。",
  },
  trend: {
    title: "文章方案",
    description: "配置文章数量、模板、配图、发布方式和质量门禁。",
  },
  accounts: {
    title: "账号矩阵",
    description: "管理公众号定位、主题风格和默认文章方案。",
  },
  sources: {
    title: "内容来源",
    description: "维护抓取 URL、抓取分组和来源健康状态。",
  },
  quality: {
    title: "质量复盘",
    description:
      "从选题、编辑决策、文章计划到审稿结果，复盘一篇文章为什么值得发布。",
  },
  runs: {
    title: "运行",
    description: "查看每次运行的状态、步骤、耗时和错误。",
  },
  artifacts: {
    title: "产物库",
    description: "预览当前运行生成的文章 HTML、配置快照、图片和 JSON。",
  },
  settings: {
    title: "系统设置",
    description: "管理文章方案、定时规则、共享能力和高级配置。",
  },
};
