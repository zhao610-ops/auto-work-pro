import { assertEquals } from "@std/assert";
import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import {
  filterUnsafeContents,
  inspectContentSafety,
} from "@src/features/weixin-article/services/content-safety-filter.service.ts";

Deno.test("内容安全门禁拦截政治与军事主题", () => {
  const political = inspectContentSafety({
    title: "特朗普与习近平会晤未就 AI 达成协议",
    content: "双方讨论贸易休战、白宫峰会与对台军售。",
  });
  const military = inspectContentSafety({
    title: "某国举行大规模军演",
    content: "报道涉及导弹和军售。",
  });

  assertEquals(political.passed, false);
  assertEquals(political.blockedCategories.includes("politics"), true);
  assertEquals(military.passed, false);
  assertEquals(military.blockedCategories.includes("military"), true);
});

Deno.test("内容安全门禁拦截违法、暴力和谣言主题", () => {
  const cases = [
    ["兼职招募", "刷单兼职获利教程", "illegal"],
    ["突发事件", "发生重大枪击并造成伤亡", "violence"],
    ["公司传闻", "网传该公司即将被收购，消息未经证实", "rumor"],
  ] as const;

  for (const [title, content, category] of cases) {
    const decision = inspectContentSafety({ title, content });
    assertEquals(decision.passed, false);
    assertEquals(decision.blockedCategories.includes(category), true);
  }
});

Deno.test("内容安全门禁拦截投资诱导、医疗建议和软文", () => {
  const cases = [
    ["财富机会", "内幕消息，立即买入即可收益翻倍", "investment-inducement"],
    ["健康秘诀", "建议每天服用这种药物，可以保证治愈", "medical-advice"],
    ["品牌福利", "限时优惠，扫码购买并添加客服", "advertorial"],
  ] as const;

  for (const [title, content, category] of cases) {
    const decision = inspectContentSafety({ title, content });
    assertEquals(decision.passed, false);
    assertEquals(decision.blockedCategories.includes(category), true);
  }
});

Deno.test("内容安全门禁允许正常的全球商业与消费趋势分析", () => {
  const cases = [
    {
      title: "苹果调整供应链：消费电子企业如何重新评估库存",
      content:
        "文章结合财报数据分析库存周转、渠道变化和消费者需求，为品牌团队提供复盘框架。",
    },
    {
      title: "耐克新营销活动如何应对价格战",
      content:
        "Nike's latest marketing campaign responds to a retail price war without killing brand value.",
    },
  ];

  for (const item of cases) {
    assertEquals(inspectContentSafety(item), {
      passed: true,
      blockedCategories: [],
      matches: [],
    });
  }
});

Deno.test("抓取后过滤只保留通过门禁的文章并输出报告", () => {
  const contents: ScrapedContent[] = [
    {
      id: "safe",
      title: "耐克更新产品与渠道策略",
      content: "文章分析品牌增长和零售渠道效率。",
      url: "https://example.com/safe",
      publishDate: "2026-09-28",
      metadata: {},
    },
    {
      id: "blocked",
      title: "特朗普与习近平举行峰会",
      content: "白宫公布会晤信息。",
      url: "https://example.com/blocked",
      publishDate: "2026-09-28",
      metadata: {},
    },
  ];

  const result = filterUnsafeContents(contents);

  assertEquals(result.contents.map((item) => item.id), ["safe"]);
  assertEquals(result.report.totalCount, 2);
  assertEquals(result.report.passedCount, 1);
  assertEquals(result.report.blockedCount, 1);
  assertEquals(result.report.blocked[0].blockedCategories, ["politics"]);
});
