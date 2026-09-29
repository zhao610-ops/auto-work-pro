import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { LLMProvider } from "@src/core/ports/llm.ts";
import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { EvidencePack } from "@src/features/weixin-article/domain/evidence.ts";
import { ToutiaoConnectedRewriteService } from "@src/features/weixin-article/services/toutiao-connected-rewrite.service.ts";

const contents: ScrapedContent[] = [{
  id: "source-1",
  title: "ASML 公布区域收入结构",
  content: "ASML 在报告中披露不同区域收入结构，不同季度会有波动。",
  url: "https://example.com/asml-report",
  publishDate: "2026-09-28",
  metadata: {},
}];

const evidencePack: EvidencePack = {
  topic: "ASML 区域收入结构",
  generatedAt: "2026-09-28T00:00:00.000Z",
  queries: ["ASML regional revenue report"],
  items: [{
    id: "evidence-1",
    title: "ASML 年度报告",
    url: "https://www.asml.com/investors/annual-report",
    provider: "search",
    sourceType: "official",
    summary: "报告按客户所在地披露区域收入，不能据此推导设备销量为零。",
    supports: ["区域收入结构存在季度波动"],
    confidence: "high",
  }, {
    id: "evidence-2",
    title: "低置信度材料",
    url: "https://example.com/low-confidence",
    provider: "search",
    sourceType: "community",
    summary: "缺少原始数据。",
    supports: [],
    confidence: "low",
  }],
  gaps: ["未找到单台设备销量口径"],
};

function createService(payload: unknown): ToutiaoConnectedRewriteService {
  const llm: LLMProvider = {
    initialize: () => Promise.resolve(),
    refresh: () => Promise.resolve(),
    setModel: () => {},
    createChatCompletion: () =>
      Promise.resolve({
        choices: [{ message: { content: JSON.stringify(payload) } }],
      }),
  };
  return new ToutiaoConnectedRewriteService(llm);
}

function longHtml(extra = ""): string {
  const paragraph =
    "区域收入数据需要结合客户所在地、设备交付节奏和确认口径理解，单一比例不能直接等同于设备销量。";
  return `<section><h2>数据应该怎样读</h2><p>${
    paragraph.repeat(14)
  }${extra}</p></section>`;
}

Deno.test("头条联网重写使用可信证据并生成可发布产物", async () => {
  const service = createService({
    title: "ASML区域收入结构释放哪些信号",
    summary: "从公开报告拆解区域收入结构，提炼企业规划可使用的判断。",
    html: longHtml(),
    verificationNotes: ["删除了无法由收入比例推出的设备销量结论。"],
    removedOrWeakenedClaims: ["欧洲一台设备都没有卖出。"],
  });

  const result = await service.rewrite({
    title: "ASML在欧洲卖不出一台设备",
    html: longHtml(),
    contents,
    evidencePack,
  });

  assertEquals(result.ready, true);
  assertEquals(result.safetyPassed, true);
  assertEquals(result.networkEvidenceCount, 1);
  assertEquals(result.sourceUrls, [
    "https://example.com/asml-report",
    "https://www.asml.com/investors/annual-report",
  ]);
  assertStringIncludes(result.title, "ASML");
  assertStringIncludes(result.html, "单一比例不能直接等同于设备销量");
});

Deno.test("头条联网重写命中内容安全门禁时停止发布", async () => {
  const service = createService({
    title: "某总统政策影响企业经营",
    summary: "政策变化影响企业经营。",
    html: longHtml("总统政策仍需继续观察。"),
    verificationNotes: [],
    removedOrWeakenedClaims: [],
  });

  const result = await service.rewrite({
    title: "企业经营观察",
    html: longHtml(),
    contents,
    evidencePack,
  });

  assertEquals(result.ready, false);
  assertEquals(result.safetyPassed, false);
  assertStringIncludes(result.error ?? "", "政治");
});

Deno.test("头条联网重写失败时返回不可发布兜底状态", async () => {
  const service = createService({
    title: "短",
    summary: "摘要",
    html: "<section><p>过短</p></section>",
  });

  const result = await service.rewrite({
    title: "原始文章标题",
    html: longHtml(),
    contents,
    evidencePack,
  });

  assertEquals(result.ready, false);
  assertEquals(result.fallback, true);
  assert(result.error);
});
