export type PromptProfileName =
  | "technology"
  | "general"
  | "business"
  | "product"
  | "developer"
  | "research";

export interface PromptProfile {
  id: PromptProfileName;
  label: string;
  audience: string;
  editorialTone: string;
  selectionFocus: string[];
  contentAngles: string[];
  preferredTopics: string[];
  lowValueSignals: string[];
  titleGuidance: string;
  layoutGuidance: string;
  imageGuidance: string;
  coverGuidance: string;
}

const PROMPT_PROFILES: Record<PromptProfileName, PromptProfile> = {
  technology: {
    id: "technology",
    label: "AI 科技趋势",
    audience:
      "关注 AI 产品、模型、开源、工程实践和科技商业动态的开发者、产品经理、创业者和内容创作者",
    editorialTone:
      "像中文科技媒体编辑：开头有新闻钩子，信息具体，节奏轻快但不油滑，有判断但不喊口号",
    selectionFocus: [
      "模型能力、AI 产品、开发者工具、开源生态、算力基础设施、监管和商业模式的新变化",
      "能回答“今天为什么要看它”的新事实、新工具或新信号",
      "对开发者、产品团队、企业采购、创作者或普通用户有实际影响的内容",
    ],
    contentAngles: [
      "新鲜点：这次真正新增了什么能力、动作、数字或限制",
      "读者关系：它会影响哪些开发、产品、创作、采购或普通使用场景",
      "行业信号：这件事背后反映了生态、成本、竞争或监管的什么变化",
    ],
    preferredTopics: [
      "模型和多模态能力更新",
      "Agent、工具调用、工作流和 AI 编程",
      "AI 产品发布、重要融资/上市、云厂商和基础设施变化",
      "高质量开源项目、基准评测、研究落地、工程实践",
      "监管、版权、安全和平台政策",
    ],
    lowValueSignals: [
      "泛泛而谈的 AI 趋势评论",
      "标题党、营销稿、缺少产品或技术细节的短帖",
      "重复转载、旧闻复述和低信息密度聚合",
    ],
    titleGuidance:
      "标题要像真实科技媒体标题：具体对象 + 新动作/反差/结果，优先保留公司、产品、模型和数字，避免“AI新趋势”“科技快报”“今日速递”等抽象模板。",
    layoutGuidance:
      "像中文科技媒体长图文：短段推进、先抛信息钩子，再讲细节和影响；重点块服务判断，不要通篇卡片和 AI 感装饰。",
    imageGuidance:
      "科技媒体配图，可使用抽象界面、芯片、数据流、开发工具、实验室桌面或产品工作流。",
    coverGuidance: "AI 行业趋势、产品更新、开发者工具和科技商业观察。",
  },
  general: {
    id: "general",
    label: "通用资讯",
    audience: "希望快速了解重要新闻和有用信息的普通读者",
    editorialTone: "清楚、可信、信息密度高，避免术语堆砌和夸张情绪",
    selectionFocus: [
      "事件本身是否重要、是否新、是否影响较多人",
      "内容是否提供清晰事实、背景和后续影响",
      "是否适合被整理成读者能快速理解的资讯短文",
    ],
    contentAngles: [
      "事实主线：先交代事件、主体、时间和变化",
      "读者影响：说明它可能影响哪些人或哪些日常决策",
      "背景补充：只补原文支持的必要背景，不展开过度分析",
    ],
    preferredTopics: [
      "重要公共事件",
      "公司与产品动态",
      "政策和社会影响",
      "生活方式、消费和工具信息",
      "有明确参考价值的深度报道",
    ],
    lowValueSignals: [
      "缺少事实来源的观点文",
      "情绪化标题",
      "重复转载和低信息量摘要",
    ],
    titleGuidance: "标题要具体说明事件和影响，不追求猎奇，不使用口号式表达。",
    layoutGuidance: "像简洁新闻简报：先给要点，再按事件展开，少装饰，多留白。",
    imageGuidance: "真实新闻感和编辑感，适合通用资讯阅读，不要科技感过强。",
    coverGuidance: "通用资讯简报、重要事件梳理、清晰现代的编辑台视觉。",
  },
  business: {
    id: "business",
    label: "商业与产业",
    audience:
      "关注公司战略、市场变化、资本动态和产业信号的管理者、投资人、创业者和从业者",
    editorialTone: "冷静、分析型、重视因果和商业影响，避免股评腔和空泛宏观叙事",
    selectionFocus: [
      "公司战略变化、融资并购、上市、裁员、产品商业化和市场竞争",
      "对行业格局、成本结构、商业模式或组织决策的影响",
      "是否能形成可追踪的产业信号",
    ],
    contentAngles: [
      "商业动作：公司做了什么、投入或取舍是什么",
      "产业信号：这件事反映了市场、成本、渠道或竞争的什么变化",
      "后续观察：它可能影响定价、客户、生态伙伴或竞争对手",
    ],
    preferredTopics: [
      "公司财报、融资、并购和上市",
      "产品商业化与定价",
      "组织调整、裁员和人才变化",
      "供应链、渠道、成本和竞争格局",
      "政策变化对企业经营的影响",
    ],
    lowValueSignals: [
      "纯市场情绪",
      "无数据支撑的宏观判断",
      "软文式公司宣传",
    ],
    titleGuidance:
      "标题突出公司、动作和商业信号，例如“某公司转向订阅制”“某市场价格战升级”。",
    layoutGuidance:
      "像商业简报：事件、原因、影响、后续观察，适合用“信号”和“影响”小节。",
    imageGuidance:
      "现代商业媒体风，可使用会议桌、数据看板、产业链、办公场景和抽象市场图形。",
    coverGuidance: "商业观察、产业信号、公司战略变化和市场趋势。",
  },
  product: {
    id: "product",
    label: "产品与体验",
    audience:
      "关注产品设计、用户体验、增长、工具更新和工作流效率的产品经理、设计师和创作者",
    editorialTone:
      "具体、用户视角、关注使用场景和体验变化，避免单纯复述发布公告",
    selectionFocus: [
      "新功能是否解决真实用户问题",
      "交互、体验、工作流、定价或可用性的变化",
      "是否有值得借鉴的产品策略、增长手段或设计取舍",
    ],
    contentAngles: [
      "用户场景：这个变化服务哪个具体人群或工作流",
      "体验差异：新旧功能、交互或定价有什么实际差别",
      "产品判断：它体现了什么定位、增长或设计取舍",
    ],
    preferredTopics: [
      "产品发布和功能更新",
      "用户体验与交互设计",
      "效率工具、创作工具和协作工具",
      "定价、套餐、增长和留存策略",
      "竞品对比和产品定位变化",
    ],
    lowValueSignals: [
      "只有口号没有功能细节",
      "无法判断用户价值的发布稿",
      "重复罗列功能点但没有场景",
    ],
    titleGuidance: "标题突出产品名、功能变化和用户价值，不写成广告语。",
    layoutGuidance: "像产品更新解读：变化点、适合谁、使用价值、可能限制。",
    imageGuidance: "产品工作流、界面抽象、设计系统、协作看板和真实使用场景感。",
    coverGuidance: "产品更新、工具效率、用户体验和工作流变化。",
  },
  developer: {
    id: "developer",
    label: "开发者与工程",
    audience:
      "关注工程实践、开源项目、API、框架、基础设施和开发效率的工程师与技术负责人",
    editorialTone: "技术准确、直接、有工程判断，避免概念包装和非技术空话",
    selectionFocus: [
      "是否有清晰技术问题、解决方案、架构变化或可复用工具",
      "是否能帮助工程师选型、调试、部署、优化或理解新能力",
      "开源项目是否有明确用途、活跃度和适用边界",
    ],
    contentAngles: [
      "问题场景：它解决了什么工程问题或开发痛点",
      "技术抓手：API、架构、框架、CLI、部署或性能上的关键点",
      "适用边界：适合谁用、不适合什么场景、上手成本如何",
    ],
    preferredTopics: [
      "开源项目、框架、SDK、API 和 CLI 工具",
      "架构实践、性能优化、部署和可观测性",
      "数据库、云基础设施、DevOps 和安全",
      "AI 编程、Agent 工程和模型集成",
      "技术教程、故障复盘和 benchmark",
    ],
    lowValueSignals: [
      "没有代码/接口/架构信息的技术营销稿",
      "只说愿景不说实现",
      "低活跃或用途不清的项目",
    ],
    titleGuidance:
      "标题应包含技术对象和工程价值，例如“某框架支持流式部署”“某工具简化 API 调试”。",
    layoutGuidance:
      "像工程笔记：问题场景、技术亮点、适用边界和上手价值，信息密度可以更高。",
    imageGuidance:
      "开发工具、代码窗口、终端、架构图感、云基础设施和工程工作台。",
    coverGuidance: "开发者工具、工程实践、开源项目、API 和基础设施。",
  },
  research: {
    id: "research",
    label: "学术与研究",
    audience:
      "关注论文、方法、实验、模型能力和研究进展的研究者、工程师和技术读者",
    editorialTone: "严谨、克制、重视方法和证据，不把研究结果包装成确定商业结论",
    selectionFocus: [
      "研究问题是否重要，方法是否新，实验是否有说服力",
      "结果对后续研究、工程实现或应用方向的启发",
      "是否能解释关键概念，而不是只翻译摘要",
    ],
    contentAngles: [
      "研究问题：论文或实验试图解决什么问题",
      "方法与证据：方法、数据、实验或评测的关键支撑是什么",
      "限制与启发：结果边界、可复现性和后续研究/工程价值",
    ],
    preferredTopics: [
      "论文、模型方法和数据集",
      "benchmark、评测和复现实验",
      "数学、科学计算、多模态、机器人和安全研究",
      "研究成果的工程化可能性",
      "重要研究机构和开源实验",
    ],
    lowValueSignals: [
      "没有方法细节的论文宣传",
      "夸大实验结果",
      "把初步研究直接等同于成熟产品",
    ],
    titleGuidance:
      "标题突出研究对象、方法或发现，避免“突破性成果”这类泛化判断。",
    layoutGuidance:
      "像研究速读：问题、方法、结果、限制和启发，允许更强结构化。",
    imageGuidance:
      "研究海报、实验室、抽象模型结构、数据可视化和论文图表感，但不要生成可读文字。",
    coverGuidance: "研究进展、模型方法、实验结果和科学计算。",
  },
};

export const DEFAULT_PROMPT_PROFILE: PromptProfileName = "technology";

export function resolvePromptProfile(
  profile?: PromptProfileName,
): PromptProfile {
  return PROMPT_PROFILES[profile ?? DEFAULT_PROMPT_PROFILE];
}

export function listPromptProfileNames(): PromptProfileName[] {
  return Object.keys(PROMPT_PROFILES) as PromptProfileName[];
}

export function getChineseNewsroomStyleGuide(
  profile?: PromptProfileName,
): string {
  const resolved = resolvePromptProfile(profile);
  const commonRules = [
    "开头第一段必须回答“这事为什么现在值得看”，不要用欢迎语、总述腔或背景铺垫开场。",
    "优先写具体主体、动作、结果、数字、限制和影响对象，少写抽象趋势判断。",
    "段落要短，每段只推进一个信息点；允许有口语节奏，但不能标题党、阴阳怪气或营销腔。",
    "避免 AI 常见句式：值得关注的是、总体来看、这意味着、未来有望、赋能、重塑、引领、开启新篇章。",
    "小标题要像编辑判断，不要只写“背景”“影响”“总结”这类目录词。",
    "结尾不写空泛展望，优先留下一个具体观察点、限制或后续变量。",
  ];

  if (resolved.id === "technology") {
    return [
      "中文科技媒体写作指南：",
      ...commonRules,
      "科技稿要把模型、产品、公司、开源项目、论文或平台动作写清楚，避免只堆“AI 行业”“智能化”等泛词。",
      "如果是多条资讯，先选一个最有读者价值的主线；如果没有主线，就写成“精选短评”，不要硬凑成宏大趋势。",
      "判断要落在读者身上：开发者能不能用、产品会怎么变、企业成本是否变化、普通用户会不会感知到。",
    ].join("\n- ");
  }

  return [
    `中文媒体写作指南（适用于${resolved.label}）：`,
    ...commonRules,
    "不同题材按题材写：产品写使用场景，商业写利益和信号，研究写方法与边界，教程写路径和限制。",
  ].join("\n- ");
}
