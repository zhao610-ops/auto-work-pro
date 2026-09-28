import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";

export type ContentSafetyCategory =
  | "politics"
  | "military"
  | "illegal"
  | "violence"
  | "rumor"
  | "investment-inducement"
  | "medical-advice"
  | "advertorial";

export interface ContentSafetyMatch {
  id: string;
  category: ContentSafetyCategory;
  categoryLabel: string;
  evidence: string;
  message: string;
}

export interface ContentSafetyDecision {
  passed: boolean;
  blockedCategories: ContentSafetyCategory[];
  matches: ContentSafetyMatch[];
}

export interface BlockedContentSafetyItem {
  id: string;
  title: string;
  url: string;
  blockedCategories: ContentSafetyCategory[];
  matches: ContentSafetyMatch[];
}

export interface ContentSafetyFilterReport {
  passed: boolean;
  totalCount: number;
  passedCount: number;
  blockedCount: number;
  blocked: BlockedContentSafetyItem[];
}

interface ContentSafetyRule {
  id: string;
  category: ContentSafetyCategory;
  categoryLabel: string;
  pattern: RegExp;
  message: string;
}

const CONTENT_SAFETY_RULES: ContentSafetyRule[] = [
  {
    id: "political-figures-and-institutions",
    category: "politics",
    categoryLabel: "政治",
    pattern:
      /特朗普|习近平|拜登|普京|泽连斯基|马克龙|莫迪|总统|总理|首相|国家主席|白宫|克里姆林宫|国会|参议院|众议院|政党|大选|竞选|选举|外交|地缘政治|台海|台湾问题|对台军售|\b(?:Trump|Xi Jinping|Biden|Putin|Zelensky|Macron|Modi|White House|Kremlin|Congress|Senate|Parliament|election|presidential campaign|election campaign|political campaign|diplomatic|geopolitics)\b/iu,
    message: "内容涉及政治人物、政治机构、选举、外交或地缘政治。",
  },
  {
    id: "military-conflict",
    category: "military",
    categoryLabel: "军事",
    pattern:
      /战争|战事|军队|军方|军事|军演|军售|武器|导弹|空袭|无人机袭击|坦克|核武|武装冲突|\b(?:warfare|military|missile|airstrike|arms sale|armed conflict|nuclear weapon|war in (?:Ukraine|Gaza))\b/iu,
    message: "内容涉及战争、军队、武器或军事行动。",
  },
  {
    id: "illegal-promotion-or-instructions",
    category: "illegal",
    categoryLabel: "违法",
    pattern:
      /(?:毒品|冰毒|海洛因|摇头丸|博彩|赌博|赌场|招嫖|卖淫|色情服务|刷单|跑分|洗钱|诈骗|黑产).{0,24}(?:购买|出售|代购|供应|批发|交易|教程|方法|渠道|平台|招募|兼职|获利|联系|入口|开户链接|送彩金)|(?:购买|出售|代购|供应|批发|交易|教程|方法|渠道|平台|招募|兼职|获利|联系|入口|开户链接|送彩金).{0,24}(?:毒品|冰毒|海洛因|摇头丸|博彩|赌博|赌场|招嫖|卖淫|色情服务|刷单|跑分|洗钱|诈骗|黑产)|\b(?:buy drugs|drug dealer|gambling bonus|betting link|money laundering tutorial|fraud tutorial)\b/iu,
    message: "内容包含违法活动的推广、交易、招募或操作指引。",
  },
  {
    id: "violent-event",
    category: "violence",
    categoryLabel: "暴力",
    pattern:
      /枪击|枪杀|谋杀|杀害|恐怖袭击|爆炸袭击|砍杀|绑架|血腥|重大伤亡|\b(?:mass shooting|fatal shooting|murder|terrorist attack|bombing attack|kidnapping|mass casualty)\b/iu,
    message: "内容以暴力事件、伤亡或恐怖袭击为主题。",
  },
  {
    id: "unverified-rumor",
    category: "rumor",
    categoryLabel: "谣言",
    pattern:
      /网传|谣言|匿名爆料|未经证实|尚未证实|真假难辨|\b(?:rumou?r|unverified|unconfirmed|anonymous leak)\b/iu,
    message: "内容包含传闻、匿名爆料或未经证实的信息。",
  },
  {
    id: "investment-call-to-action",
    category: "investment-inducement",
    categoryLabel: "投资诱导",
    pattern:
      /荐股|带单|跟单|抄底|稳赚不赔|保本高收益|零风险高收益|收益翻倍|内幕消息|立即开户|立即买入|强烈买入|目标价.{0,12}(?:上涨|翻倍)|\b(?:guaranteed return|risk-free return|buy (?:this )?(?:stock|crypto) now|strong buy|insider tip|double your money)\b/iu,
    message: "内容包含荐股、收益承诺、买卖指令或开户引流。",
  },
  {
    id: "medical-treatment-advice",
    category: "medical-advice",
    categoryLabel: "医疗建议",
    pattern:
      /(?:建议|应该|可以|每天|立即).{0,12}(?:服用|用药|停药|加量|减量|注射)|(?:治疗方法|治疗方案|偏方|秘方).{0,16}(?:治愈|根治|疗效|用药)|包治|保证治愈|替代医生|\b(?:medical advice|take this medicine|stop taking|dosage advice|guaranteed cure)\b/iu,
    message: "内容提供具体用药、治疗或疗效保证。",
  },
  {
    id: "advertorial-call-to-action",
    category: "advertorial",
    categoryLabel: "软文",
    pattern:
      /立即购买|点击购买|限时优惠|扫码咨询|扫码购买|加微信|添加客服|招商加盟|代理招募|免费领取|全网最低|购买链接|联系我们下单|\b(?:buy now|limited-time offer|scan to buy|contact us to order|affiliate link)\b/iu,
    message: "内容包含明显的购买、咨询、加盟或促销引流。",
  },
];

export function inspectContentSafety(input: {
  title: string;
  content: string;
}): ContentSafetyDecision {
  const text = normalizeContentSafetyText(`${input.title}\n${input.content}`);
  const matches = CONTENT_SAFETY_RULES.flatMap((rule) => {
    const match = text.match(rule.pattern);
    if (!match) return [];
    return [
      {
        id: rule.id,
        category: rule.category,
        categoryLabel: rule.categoryLabel,
        evidence: match[0].slice(0, 80),
        message: rule.message,
      } satisfies ContentSafetyMatch,
    ];
  });
  return {
    passed: matches.length === 0,
    blockedCategories: [...new Set(matches.map((match) => match.category))],
    matches,
  };
}

export function filterUnsafeContents(
  contents: ScrapedContent[],
): { contents: ScrapedContent[]; report: ContentSafetyFilterReport } {
  const passed: ScrapedContent[] = [];
  const blocked: BlockedContentSafetyItem[] = [];
  for (const content of contents) {
    const decision = inspectContentSafety({
      title: content.title,
      content: content.content,
    });
    if (decision.passed) {
      passed.push(content);
      continue;
    }
    blocked.push({
      id: content.id,
      title: content.title,
      url: content.url,
      blockedCategories: decision.blockedCategories,
      matches: decision.matches,
    });
  }
  return {
    contents: passed,
    report: {
      passed: blocked.length === 0,
      totalCount: contents.length,
      passedCount: passed.length,
      blockedCount: blocked.length,
      blocked,
    },
  };
}

function normalizeContentSafetyText(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
