import { dirname, fromFileUrl, join } from "jsr:@std/path@1";
import {
  type BrowserContext,
  chromium,
  type Page,
} from "npm:playwright-core@1.56.1";
import { ToutiaoRelayError } from "./errors.ts";
import {
  assertPublishContentLength,
  assertPublishCoverProvided,
} from "./publication-preflight.ts";
import { ToutiaoArticleRecordStore } from "./article-record-store.ts";
import { findMatchingDraft, type RemoteArticle } from "./reconciliation.ts";
import type {
  ToutiaoArticleRecord,
  ToutiaoDraftRequest,
  ToutiaoDraftResult,
  ToutiaoPublishRequest,
  ToutiaoPublishResult,
  ToutiaoRelayConfig,
  ToutiaoSessionStatus,
} from "./types.ts";

const PUBLISH_URL = "https://mp.toutiao.com/profile_v4/graphic/publish";
const LOGIN_URL = "https://mp.toutiao.com/auth/page/login/";
const DRAFT_LIST_URL = "https://mp.toutiao.com/profile_v4/manage/draft";
const CONTENT_LIST_URL = "https://mp.toutiao.com/profile_v4/manage/content/all";

export class ToutiaoBrowserSession {
  private context?: BrowserContext;
  private readonly records: ToutiaoArticleRecordStore;

  constructor(private readonly config: ToutiaoRelayConfig) {
    this.records = new ToutiaoArticleRecordStore(config.statePath);
  }

  async getSessionStatus(): Promise<ToutiaoSessionStatus> {
    const page = await this.newPage();
    try {
      const status = await this.checkLoginStatus(page);
      if (status.loggedIn) return status;
      return {
        ...status,
        screenshotPath: await this.captureScreenshot(page, "session-expired"),
      };
    } finally {
      await page.close().catch(() => {});
    }
  }

  async openLoginPage(): Promise<ToutiaoSessionStatus> {
    const page = await this.newPage({ forceVisible: true });
    await page.goto(LOGIN_URL, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    return {
      loggedIn: false,
      currentUrl: page.url(),
      message: "登录页已打开，请在浏览器窗口完成扫码或账号登录。",
    };
  }

  async saveDraft(request: ToutiaoDraftRequest): Promise<ToutiaoDraftResult> {
    validateDraftRequest(request);
    const existing = await this.findExistingRecord(request, "draft");
    if (existing) return draftResultFromRecord(existing);
    const page = await this.newPage();
    try {
      const session = await this.checkLoginStatus(page);
      if (!session.loggedIn) {
        const screenshotPath = await this.captureScreenshot(
          page,
          "session-expired",
        );
        return {
          draftId: request.idempotencyKey ?? crypto.randomUUID(),
          status: "blocked",
          title: request.title.trim(),
          currentUrl: session.currentUrl ?? page.url(),
          savedAt: new Date().toISOString(),
          idempotencyKey: request.idempotencyKey,
          reason: "今日头条账号未登录，请先调用 /api/toutiao/login 完成登录。",
          errorCode: "AUTH_EXPIRED",
          screenshotPath,
        };
      }

      await openFreshPublishPage(page);
      const article = await prepareArticle(page, request);

      await saveDraft(page);
      const screenshotPath = await this.captureScreenshot(page, "draft-saved");
      const record = await this.persistReconciledRecord({
        request,
        status: "draft",
      });
      return {
        draftId: record?.articleId ?? request.idempotencyKey ??
          crypto.randomUUID(),
        status: "draft",
        title: article.title,
        currentUrl: page.url(),
        savedAt: new Date().toISOString(),
        idempotencyKey: request.idempotencyKey,
        screenshotPath,
        contentVerified: true,
        coverUploaded: article.coverUploaded,
        articleId: record?.articleId,
        reconciledAt: record?.reconciledAt,
      };
    } catch (error) {
      const screenshotPath = await this.captureScreenshot(page, "draft-error")
        .catch(() => undefined);
      const relayError = error instanceof ToutiaoRelayError
        ? error
        : new ToutiaoRelayError(
          "UNKNOWN",
          error instanceof Error ? error.message : String(error),
        );
      throw new ToutiaoRelayError(
        relayError.code,
        `${relayError.message}${
          screenshotPath ? `；截图：${screenshotPath}` : ""
        }`,
        {
          ...relayError.details,
          ...(screenshotPath ? { screenshotPath } : {}),
        },
      );
    } finally {
      await page.close().catch(() => {});
    }
  }

  /** 系统到点后调用：浏览器仅执行头条的立即正式发布，不配置平台原生定时。 */
  async publishNow(
    request: ToutiaoPublishRequest,
  ): Promise<ToutiaoPublishResult> {
    validateDraftRequest(request);
    // 正式发布要求“原创封面”。必须在写入编辑器前校验，
    // 否则会留下无法提交且难以恢复的半成品草稿。
    assertPublishCoverProvided(request);
    assertPublishContentLength(request);
    const coverPath = await requirePublishCover(request);
    const existing = await this.findExistingRecord(request, "publish");
    if (existing?.status === "published") {
      return publishResultFromRecord(existing);
    }
    const page = await this.newPage();
    try {
      const session = await this.checkLoginStatus(page);
      if (!session.loggedIn) {
        const screenshotPath = await this.captureScreenshot(
          page,
          "session-expired",
        );
        return {
          draftId: request.idempotencyKey ?? crypto.randomUUID(),
          status: "blocked",
          title: request.title.trim(),
          currentUrl: session.currentUrl ?? page.url(),
          idempotencyKey: request.idempotencyKey,
          reason: "今日头条账号未登录，请先调用 /api/toutiao/login 完成登录。",
          errorCode: "AUTH_EXPIRED",
          screenshotPath,
        };
      }

      let article: PreparedArticle;
      let record: ToutiaoArticleRecord | undefined;
      if (existing) {
        await openExistingDraftForEditing(page, existing);
        await uploadCover(page, coverPath);
        article = { title: existing.title, coverUploaded: true };
        record = await this.records.upsert({
          ...existing,
          coverUploaded: true,
          updatedAt: new Date().toISOString(),
        });
      } else {
        await openFreshPublishPage(page);
        article = await prepareArticle(page, {
          ...request,
          coverImagePath: coverPath,
        });
        await saveDraft(page);

        // 先在草稿列表获取真实 ID，再确认定时；即使最后一步网络超时，也可安全反查。
        record = await this.persistReconciledRecord({
          request,
          status: "draft",
        });
        if (record) {
          record = await this.records.upsert({
            ...record,
            contentVerified: true,
            coverUploaded: article.coverUploaded,
            updatedAt: new Date().toISOString(),
          });
        }
      }

      await publishImmediately(page);
      // 页面确认发布后立即反查，取得作品 ID。列表短暂延迟时仍以成功确认作为终态，
      // 后续调度心跳会再次反查并补齐 articleId。
      const remote = await findManagedContentByTitle(page, article.title);
      const publishedRecord = record && request.idempotencyKey
        ? await this.records.upsert({
          ...record,
          articleId: remote?.articleId ?? record.articleId,
          status: "published",
          currentUrl: remote?.currentUrl ?? page.url(),
          updatedAt: new Date().toISOString(),
          reconciledAt: new Date().toISOString(),
        })
        : record;
      const screenshotPath = await this.captureScreenshot(page, "published");
      return {
        draftId: publishedRecord?.articleId ?? request.idempotencyKey ??
          crypto.randomUUID(),
        status: "published",
        title: article.title,
        currentUrl: page.url(),
        idempotencyKey: request.idempotencyKey,
        screenshotPath,
        contentVerified: true,
        coverUploaded: article.coverUploaded,
        articleId: publishedRecord?.articleId,
        reconciledAt: publishedRecord?.reconciledAt,
      };
    } catch (error) {
      const screenshotPath = await this.captureScreenshot(
        page,
        "publish-error",
      )
        .catch(() => undefined);
      const relayError = error instanceof ToutiaoRelayError
        ? error
        : new ToutiaoRelayError(
          "UNKNOWN",
          error instanceof Error ? error.message : String(error),
        );
      throw new ToutiaoRelayError(
        relayError.code,
        `${relayError.message}${
          screenshotPath ? `；截图：${screenshotPath}` : ""
        }`,
        {
          ...relayError.details,
          ...(screenshotPath ? { screenshotPath } : {}),
        },
      );
    } finally {
      await page.close().catch(() => {});
    }
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => {});
    this.context = undefined;
  }

  async reconcileArticle(input: {
    idempotencyKey?: string;
    title?: string;
  }): Promise<ToutiaoArticleRecord> {
    const record = input.idempotencyKey
      ? await this.records.get(input.idempotencyKey)
      : input.title
      ? await this.records.findByTitle(input.title.trim())
      : undefined;
    if (!record) {
      throw new ToutiaoRelayError(
        "RECONCILE_NOT_FOUND",
        "没有找到对应的本地头条任务记录，请提供已提交任务的 idempotencyKey 或精确标题",
      );
    }

    const page = await this.newPage();
    try {
      const session = await this.checkLoginStatus(page);
      if (!session.loggedIn) {
        throw new ToutiaoRelayError(
          "AUTH_EXPIRED",
          "今日头条账号未登录，无法反查发布状态",
        );
      }
      const remote = await findRemoteArticleByTitle(page, record.title);
      if (!remote) {
        if (record.status === "pending_reconciliation") {
          throw new ToutiaoRelayError(
            "RECONCILE_NOT_FOUND",
            "草稿列表尚未检索到该文章；请稍后重试，Relay 已保留幂等记录并不会重复创建",
          );
        }
        return record;
      }
      const now = new Date().toISOString();
      return await this.records.upsert({
        ...record,
        articleId: remote.articleId,
        status: remote.status,
        currentUrl: remote.currentUrl,
        updatedAt: now,
        reconciledAt: now,
      });
    } finally {
      await page.close().catch(() => {});
    }
  }

  private async findExistingRecord(
    request: ToutiaoDraftRequest,
    operation: "draft" | "publish",
  ): Promise<ToutiaoArticleRecord | undefined> {
    if (!request.idempotencyKey) return undefined;
    const record = await this.records.get(request.idempotencyKey);
    if (!record) return undefined;
    if (record.title !== request.title.trim()) {
      throw new ToutiaoRelayError(
        "IDEMPOTENCY_CONFLICT",
        "同一个 idempotencyKey 已关联另一篇头条文章，拒绝覆盖",
        { previousTitle: record.title, requestedTitle: request.title.trim() },
      );
    }
    if (
      operation === "draft" &&
      (record.status === "draft" || record.status === "pending_reconciliation")
    ) {
      return record;
    }
    if (operation === "publish" && record.status === "published") {
      return record;
    }
    if (operation === "publish" && record.status === "draft") {
      return record;
    }
    throw new ToutiaoRelayError(
      "IDEMPOTENCY_CONFLICT",
      `该 idempotencyKey 的既有状态为 ${record.status}，不能直接执行 ${operation} 操作；请先调用反查接口确认状态。`,
    );
  }

  private async persistReconciledRecord(input: {
    request: ToutiaoDraftRequest;
    status: "draft";
  }): Promise<ToutiaoArticleRecord | undefined> {
    if (!input.request.idempotencyKey) return undefined;
    const now = new Date().toISOString();
    const page = await this.newPage();
    let remote: RemoteArticle | undefined;
    try {
      remote = await findRemoteArticleByTitle(page, input.request.title.trim());
    } finally {
      await page.close().catch(() => {});
    }
    return await this.records.upsert({
      idempotencyKey: input.request.idempotencyKey,
      title: input.request.title.trim(),
      articleId: remote?.articleId,
      status: remote?.status ?? "pending_reconciliation",
      currentUrl: remote?.currentUrl,
      createdAt: now,
      updatedAt: now,
      reconciledAt: now,
    });
  }

  private async newPage(
    options: { forceVisible?: boolean } = {},
  ): Promise<Page> {
    const context = await this.ensureContext(options.forceVisible ?? false);
    return await context.newPage();
  }

  private async ensureContext(forceVisible: boolean): Promise<BrowserContext> {
    if (this.context) return this.context;
    await Deno.mkdir(this.config.profileDir, { recursive: true });
    await Deno.mkdir(this.config.screenshotsDir, { recursive: true });

    const launchOptions = {
      headless: forceVisible ? false : this.config.headless,
      executablePath: this.config.chromeExecutablePath,
      channel: this.config.chromeExecutablePath
        ? undefined
        : this.config.chromeChannel,
      viewport: { width: 1440, height: 1000 },
      locale: "zh-CN",
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
      ],
    };

    try {
      this.context = await chromium.launchPersistentContext(
        this.config.profileDir,
        launchOptions,
      );
      this.context.setDefaultTimeout(20_000);
      return this.context;
    } catch (error) {
      throw new ToutiaoRelayError(
        "BROWSER_LAUNCH_FAILED",
        `启动浏览器失败：${
          error instanceof Error ? error.message : String(error)
        }。请安装 Chrome，或设置 TOUTIAO_CHROME_EXECUTABLE_PATH 指向可执行文件。`,
      );
    }
  }

  private async checkLoginStatus(page: Page): Promise<ToutiaoSessionStatus> {
    await page.goto(PUBLISH_URL, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    }).catch(async () => {
      await page.goto(LOGIN_URL, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
    });
    await page.waitForLoadState("networkidle", { timeout: 8_000 })
      .catch(() => {});

    const currentUrl = page.url();
    if (isLoginUrl(currentUrl)) {
      return {
        loggedIn: false,
        currentUrl,
        message: "当前跳转到登录页，说明持久化浏览器资料中还没有有效登录态。",
      };
    }

    const editorVisible = await hasVisibleLocator(page, [
      "textarea[placeholder*='标题']",
      "input[placeholder*='标题']",
      "[contenteditable='true']",
      "text=发布",
      "text=存草稿",
      "text=保存草稿",
    ]);
    return {
      loggedIn: editorVisible,
      currentUrl,
      message: editorVisible
        ? "已检测到今日头条创作页面登录态。"
        : "页面已打开，但没有识别到创作器，可能需要手动完成安全验证。",
    };
  }

  private async captureScreenshot(
    page: Page,
    label: string,
  ): Promise<string | undefined> {
    await Deno.mkdir(this.config.screenshotsDir, { recursive: true });
    const fileName = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${
      sanitizeFileSegment(label)
    }.png`;
    const path = join(this.config.screenshotsDir, fileName);
    await page.screenshot({ path, fullPage: true });
    return path;
  }
}

function validateDraftRequest(request: ToutiaoDraftRequest): void {
  const title = request.title?.trim();
  const content = (request.contentHtml ?? request.contentText ?? "").trim();
  if (!title) {
    throw new ToutiaoRelayError("CONTENT_INVALID", "title 不能为空");
  }
  if (!content) {
    throw new ToutiaoRelayError(
      "CONTENT_INVALID",
      "contentHtml 或 contentText 不能为空",
    );
  }
}

interface PreparedArticle {
  title: string;
  coverUploaded: boolean;
}

/**
 * 定时配置失败后，已落库的草稿必须在原文上继续操作，不能重新创建一篇同标题文章。
 * 头条编辑器目前兼容 draft_id 与 group_id 两种草稿入口，逐个验证标题后再继续。
 */
async function openExistingDraftForEditing(
  page: Page,
  record: ToutiaoArticleRecord,
): Promise<void> {
  if (!record.articleId) {
    throw new ToutiaoRelayError(
      "RECONCILE_NOT_FOUND",
      "已找到本地草稿记录，但尚未取得头条真实草稿 ID，不能安全继续正式发布。",
    );
  }
  const draftId = encodeURIComponent(record.articleId);
  const candidates = [
    `${PUBLISH_URL}?draft_id=${draftId}`,
    `${PUBLISH_URL}?group_id=${draftId}`,
  ];
  for (const url of candidates) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await waitForEditor(page).catch(() => {});
    const title = await page.evaluate(() => {
      const element = document.querySelector<
        HTMLInputElement | HTMLTextAreaElement
      >(
        "textarea[placeholder*='标题'],input[placeholder*='标题']",
      );
      return element?.value?.trim() ?? "";
    });
    if (title === record.title) return;
  }
  // URL 参数可能随头条版本变化；草稿列表中的标题入口是更稳定的兜底路径。
  await page.goto(DRAFT_LIST_URL, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  // 草稿列表为异步渲染，domcontentloaded 后仍可能是空白骨架屏。
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(
    () => {},
  );
  await page.waitForTimeout(2_000);
  const draftTitle = page.getByText(record.title, { exact: true }).last();
  if (await draftTitle.isVisible().catch(() => false)) {
    await draftTitle.click();
    await waitForEditor(page).catch(() => {});
    const title = await page.evaluate(() => {
      const element = document.querySelector<
        HTMLInputElement | HTMLTextAreaElement
      >(
        "textarea[placeholder*='标题'],input[placeholder*='标题']",
      );
      return element?.value?.trim() ?? "";
    });
    if (title === record.title) return;
  }
  throw new ToutiaoRelayError(
    "RECONCILE_NOT_FOUND",
    "无法重新打开已保存的头条草稿，已停止以避免重复创建文章。",
    { articleId: record.articleId },
  );
}

async function prepareArticle(
  page: Page,
  request: ToutiaoDraftRequest,
): Promise<PreparedArticle> {
  await waitForEditor(page);
  const title = request.title.trim();
  const content = request.contentHtml ?? request.contentText ?? "";
  await fillTitle(page, title);
  await verifyTitleReadback(page, title);
  await fillContent(page, content);
  await verifyContentReadback(page, content);

  const coverPath = await prepareCoverImage(request);
  if (coverPath) await uploadCover(page, coverPath);
  return { title, coverUploaded: Boolean(coverPath) };
}

/**
 * 头条编辑器会在同一浏览器资料中恢复最近一次本地草稿。
 * 仅清理发布页的草稿恢复键，再重新加载页面；登录 Cookie、服务器草稿和其它站点数据均保留。
 */
async function openFreshPublishPage(page: Page): Promise<void> {
  await page.goto(PUBLISH_URL, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  const removed = await page.evaluate(() => {
    const removable = Object.keys(localStorage).filter((key) =>
      /(draft|graphic|publish|editor)/i.test(key)
    );
    for (const key of removable) localStorage.removeItem(key);
    return removable.length;
  }).catch(() => 0);
  if (removed > 0) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
  }
}

async function waitForEditor(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const titleInput = document.querySelector(
        "textarea[placeholder*='标题'],input[placeholder*='标题']",
      );
      const editable = document.querySelector("[contenteditable='true']");
      return Boolean(titleInput || editable);
    },
    undefined,
    { timeout: 30_000 },
  ).catch(() => {
    throw new ToutiaoRelayError(
      "EDITOR_NOT_FOUND",
      "30 秒内没有找到今日头条编辑器",
    );
  });
}

async function fillTitle(page: Page, title: string): Promise<void> {
  const selectors = [
    "textarea[placeholder*='标题']",
    "input[placeholder*='标题']",
    "[contenteditable='true'][data-placeholder*='标题']",
    "[contenteditable='true'][placeholder*='标题']",
  ];
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      await locator.click();
      await locator.fill(title).catch(async () => {
        await page.keyboard.press(
          Deno.build.os === "darwin" ? "Meta+A" : "Control+A",
        );
        await page.keyboard.type(title);
      });
      return;
    }
  }
  throw new ToutiaoRelayError("EDITOR_NOT_FOUND", "没有找到今日头条标题输入框");
}

async function fillContent(page: Page, content: string): Promise<void> {
  const inserted = await page.evaluate((value) => {
    const editables = [...document.querySelectorAll<HTMLElement>(
      "[contenteditable='true']",
    )].filter((element) => {
      const rect = element.getBoundingClientRect();
      const text = `${element.getAttribute("placeholder") ?? ""} ${
        element.getAttribute("data-placeholder") ?? ""
      }`;
      return rect.width > 240 && rect.height > 80 && !text.includes("标题");
    });
    const target = editables.sort((left, right) =>
      right.getBoundingClientRect().height - left.getBoundingClientRect().height
    )[0];
    if (!target) {
      return false;
    }
    target.focus();
    target.innerHTML = value.includes("<") ? value : textToHtml(value);
    target.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: target.innerText,
      }),
    );
    target.dispatchEvent(new Event("change", { bubbles: true }));
    return true;

    function textToHtml(text: string): string {
      return text.split(/\n{2,}/).map((paragraph) =>
        `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`
      ).join("");
    }

    function escapeHtml(text: string): string {
      return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }
  }, content);
  if (!inserted) {
    throw new ToutiaoRelayError(
      "EDITOR_NOT_FOUND",
      "没有找到今日头条正文编辑器",
    );
  }
}

async function verifyTitleReadback(
  page: Page,
  expected: string,
): Promise<void> {
  const actual = await page.evaluate(() => {
    const element = document.querySelector<
      HTMLInputElement | HTMLTextAreaElement
    >(
      "textarea[placeholder*='标题'],input[placeholder*='标题']",
    );
    return element?.value?.trim() ?? "";
  });
  if (actual !== expected) {
    throw new ToutiaoRelayError(
      "CONTENT_READBACK_FAILED",
      "标题写入后回读不一致",
      {
        expectedTitle: expected,
        actualTitle: actual,
      },
    );
  }
}

async function verifyContentReadback(
  page: Page,
  expected: string,
): Promise<void> {
  const expectedText = toPlainText(expected);
  const actualText = await page.evaluate(() => {
    const editables = [
      ...document.querySelectorAll<HTMLElement>("[contenteditable='true']"),
    ]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const label = `${element.getAttribute("placeholder") ?? ""} ${
          element.getAttribute("data-placeholder") ?? ""
        }`;
        return rect.width > 240 && rect.height > 80 && !label.includes("标题");
      });
    return editables.sort((left, right) =>
      right.getBoundingClientRect().height - left.getBoundingClientRect().height
    )[0]
      ?.innerText ?? "";
  });
  const expectedNormalized = normalizeText(expectedText);
  const actualNormalized = normalizeText(actualText);
  // 头条会按段落、超链接和视觉换行拆分文本节点，逐字连续包含会把完整正文
  // 误判为缺失。用开头锚点与 90% 有效长度共同校验，仍可拦截半截写入。
  const anchor = expectedNormalized.slice(0, Math.min(80, expectedNormalized.length));
  const contentLooksComplete = actualNormalized.includes(anchor) &&
    actualNormalized.length >= expectedNormalized.length * 0.9;
  if (!contentLooksComplete) {
    throw new ToutiaoRelayError(
      "CONTENT_READBACK_FAILED",
      "正文写入后回读不完整",
      {
        expectedPreview: expectedText.slice(0, 120),
        actualPreview: actualNormalized.slice(0, 120),
      },
    );
  }
}

async function uploadCover(page: Page, imagePath: string): Promise<void> {
  const addCover = page.locator(".article-cover-add").first();
  if (!await addCover.isVisible().catch(() => false)) {
    throw new ToutiaoRelayError(
      "COVER_UPLOAD_FAILED",
      "没有找到今日头条封面加号卡片",
    );
  }

  await addCover.click();
  const drawer = page.locator(".byte-drawer").filter({ hasText: "上传图片" })
    .last();
  const uploadInput = drawer.locator("input[type='file'][accept*='image']")
    .first();
  if (!await uploadInput.count()) {
    throw new ToutiaoRelayError(
      "COVER_UPLOAD_FAILED",
      "图片上传抽屉中没有找到文件输入框",
    );
  }

  await uploadInput.setInputFiles(imagePath).catch((error) => {
    throw new ToutiaoRelayError(
      "COVER_UPLOAD_FAILED",
      "今日头条拒绝接收封面文件",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  });
  await drawer.getByText(/已上传\s*1\s*张图片/).waitFor({
    state: "visible",
    timeout: 20_000,
  }).catch(() => {
    throw new ToutiaoRelayError(
      "COVER_UPLOAD_FAILED",
      "封面文件上传后未出现在图片抽屉中",
    );
  });

  await drawer.getByRole("button", { name: "确定", exact: true }).click();
  await drawer.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {
    throw new ToutiaoRelayError(
      "COVER_UPLOAD_FAILED",
      "封面图片确认窗口没有关闭",
    );
  });
  await page.locator(".article-cover-images img").first().waitFor({
    state: "visible",
    timeout: 15_000,
  }).catch(() => {
    throw new ToutiaoRelayError(
      "COVER_UPLOAD_FAILED",
      "封面图片没有回填到文章表单",
    );
  });
}

async function saveDraft(page: Page): Promise<void> {
  const candidates = [
    page.getByRole("button", { name: /存草稿|保存草稿|草稿/ }).first(),
    page.getByText(/存草稿|保存草稿/).first(),
  ];
  for (const candidate of candidates) {
    if (await candidate.isVisible().catch(() => false)) {
      await candidate.click();
      await page.waitForTimeout(1500);
      await dismissOptionalDialog(page);
      return;
    }
  }

  // 目前的头条图文编辑器会在输入后自动保存，不再提供旧版的“保存草稿”按钮。
  // 必须等待“保存中”结束，避免把尚未落盘的页面误报为成功。
  const autoSaveStarted = page.getByText(/草稿保存中|正在保存草稿/).first();
  const autoSaveCompleted = page.getByText(/草稿已保存|草稿保存成功|已保存草稿/)
    .first();
  const hasAutoSaveStatus =
    await autoSaveStarted.isVisible().catch(() => false) ||
    await autoSaveCompleted.isVisible().catch(() => false);

  if (!hasAutoSaveStatus) {
    throw new ToutiaoRelayError(
      "DRAFT_SAVE_FAILED",
      "没有找到今日头条草稿保存控件或自动保存状态",
    );
  }

  await autoSaveCompleted.waitFor({ state: "visible", timeout: 15_000 })
    .catch(async () => {
      const stillSaving = await autoSaveStarted.isVisible().catch(() => false);
      if (stillSaving) {
        throw new ToutiaoRelayError(
          "DRAFT_SAVE_TIMEOUT",
          "今日头条草稿仍在保存中，15 秒内未确认完成",
        );
      }
      throw new ToutiaoRelayError(
        "DRAFT_SAVE_FAILED",
        "未识别到今日头条草稿保存完成状态",
      );
    });
}

/** 只走头条立即发布：先打开预览，再确认最终“发布”，不触碰原生定时控件。 */
async function publishImmediately(page: Page): Promise<void> {
  const previewButton = page.getByRole("button", {
    name: "预览并发布",
    exact: true,
  });
  if (!await previewButton.isVisible().catch(() => false)) {
    throw new ToutiaoRelayError(
      "PUBLISH_CONTROL_NOT_FOUND",
      "没有找到今日头条“预览并发布”按钮",
    );
  }
  if (await previewButton.isDisabled().catch(() => false)) {
    throw new ToutiaoRelayError(
      "CONTENT_INVALID",
      "今日头条将“预览并发布”按钮置灰；请检查正文长度、封面和发布必填项。",
    );
  }
  await previewButton.click();

  const confirmButton = page.getByRole("button", {
    name: /^(发布|确认发布|立即发布)$/,
  }).last();
  await confirmButton.waitFor({ state: "visible", timeout: 20_000 }).catch(
    () => {},
  );
  if (!await confirmButton.isVisible().catch(() => false)) {
    throw new ToutiaoRelayError(
      "PUBLISH_CONFIRM_FAILED",
      "打开发布预览 20 秒后仍没有找到最终发布确认按钮",
    );
  }
  if (await confirmButton.isDisabled().catch(() => false)) {
    throw new ToutiaoRelayError(
      "CONTENT_INVALID",
      "今日头条将最终发布确认按钮置灰；请检查发布必填项。",
    );
  }
  await confirmButton.click();
  const success = await Promise.any([
    page.getByText(/发布成功|作品发布成功|已发布成功/).first().waitFor({
      state: "visible",
      timeout: 20_000,
    }).then(() => true),
    page.waitForURL(/\/manage\/content|\/profile_v4\/manage/, {
      timeout: 20_000,
    }).then(() => true),
  ]).catch(() => false);
  if (!success) {
    throw new ToutiaoRelayError(
      "PUBLISH_CONFIRM_FAILED",
      "点击最终发布后未检测到成功提示或作品管理页，已停止并保留截图供核查。",
    );
  }
}

async function dismissOptionalDialog(page: Page): Promise<void> {
  const confirm = page.getByRole("button", { name: /确定|确认|知道了/ })
    .first();
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.click().catch(() => {});
  }
}

async function prepareCoverImage(
  request: ToutiaoDraftRequest,
): Promise<string | undefined> {
  if (request.coverImagePath) {
    const path = request.coverImagePath;
    const stat = await Deno.stat(path).catch(() => undefined);
    if (!stat?.isFile) {
      throw new ToutiaoRelayError(
        "COVER_NOT_FOUND",
        "coverImagePath 指向的封面文件不存在",
        { path },
      );
    }
    return path;
  }
  if (!request.coverImageUrl) return undefined;
  const response = await fetch(request.coverImageUrl);
  if (!response.ok) {
    throw new ToutiaoRelayError(
      "COVER_UPLOAD_FAILED",
      `下载封面失败：HTTP ${response.status}`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const suffix = imageSuffixFromContentType(
    response.headers.get("content-type") ?? "",
  );
  const tempDir = await Deno.makeTempDir({ prefix: "toutiao-cover-" });
  const path = join(tempDir, `cover${suffix}`);
  await Deno.writeFile(path, bytes);
  return path;
}

async function requirePublishCover(
  request: ToutiaoPublishRequest,
): Promise<string> {
  const coverPath = await prepareCoverImage(request);
  if (!coverPath) {
    throw new ToutiaoRelayError(
      "COVER_NOT_FOUND",
      "今日头条正式发布必须提供原创封面；请先生成或上传 coverImagePath。",
    );
  }
  return coverPath;
}

/**
 * 以头条草稿列表接口为主源反查文章。页面 DOM 仅用于确认该标题确实出现，
 * 不从 DOM 猜测文章 ID，避免因页面改版产生错误映射。
 */
async function findRemoteArticleByTitle(
  page: Page,
  title: string,
): Promise<RemoteArticle | undefined> {
  // 已提交的作品在“作品管理”和“草稿箱”可能短暂同时出现。优先作品管理，
  // 防止同标题草稿掩盖已进入审核或已发布的真实终态。
  return await findManagedContentByTitle(page, title) ??
    await findDraftByTitle(page, title);
}

async function findDraftByTitle(
  page: Page,
  title: string,
): Promise<RemoteArticle | undefined> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/creator_center/draft_list") &&
        response.request().method() === "GET",
      { timeout: 15_000 },
    ).catch(() => undefined);
    await page.goto(`${DRAFT_LIST_URL}?reconcile=${Date.now()}-${attempt}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const response = await responsePromise;
    if (response) {
      const payload = await response.json().catch(() => undefined);
      const draft = findMatchingDraft(payload, title);
      if (draft) return draft;
    }
    // 列表接口偶尔会先返回旧缓存，短暂等待后再发起一次请求。
    await page.waitForTimeout(1_000);
  }

  const draftItem = page.locator(".article-draft-item").filter({
    hasText: title,
  });
  if (await draftItem.count()) {
    // DOM 兜底只证明草稿已出现；没有稳定 ID 时必须继续保持待反查状态。
    const dataId = await draftItem.first().evaluate((element) =>
      element.getAttribute("data-id") ?? element.getAttribute("data-draft-id")
    );
    if (dataId?.trim()) {
      return {
        articleId: dataId.trim(),
        currentUrl: page.url(),
        status: "draft",
      };
    }
  }
  return undefined;
}

/** 从作品管理接口反查已定时或已发布内容。 */
async function findManagedContentByTitle(
  page: Page,
  title: string,
): Promise<RemoteArticle | undefined> {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/feed/mp_provider/v1/") &&
      response.request().method() === "GET",
    { timeout: 15_000 },
  ).catch(() => undefined);
  await page.goto(`${CONTENT_LIST_URL}?reconcile=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  const response = await responsePromise;
  if (!response) return undefined;
  return findMatchingManagedContent(
    await response.json().catch(() => undefined),
    title,
  );
}

function findMatchingManagedContent(
  value: unknown,
  title: string,
): RemoteArticle | undefined {
  for (const item of findObjectsWithTitle(value, title)) {
    const articleId = firstString(
      item.article_id,
      item.content_id,
      item.item_id,
      item.group_id,
      item.id,
    );
    if (!articleId) continue;
    const statusText = [
      item.status,
      item.status_desc,
      item.publish_status,
      item.publish_status_desc,
      item.display_status,
    ].map((entry) => String(entry ?? "")).join(" ");
    const status = /定时|schedule/i.test(statusText) ||
        hasFuturePublishTime(item.publish_time ?? item.publishTime)
      ? "scheduled"
      : "published";
    return {
      articleId,
      status,
      currentUrl: firstString(item.url, item.edit_url) ?? CONTENT_LIST_URL,
    };
  }
  return undefined;
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
  const matched = readString(object.title) === title ? [object] : [];
  return [
    ...matched,
    ...Object.values(object).flatMap((item) =>
      findObjectsWithTitle(item, title)
    ),
  ];
}

function hasFuturePublishTime(value: unknown): boolean {
  if (typeof value === "number") {
    const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value;
    return milliseconds > Date.now();
  }
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now();
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

function draftResultFromRecord(
  record: ToutiaoArticleRecord,
): ToutiaoDraftResult {
  return {
    draftId: record.articleId ?? record.idempotencyKey,
    status: "draft",
    title: record.title,
    currentUrl: record.currentUrl ?? PUBLISH_URL,
    savedAt: record.updatedAt,
    idempotencyKey: record.idempotencyKey,
    articleId: record.articleId,
    reconciledAt: record.reconciledAt,
    reason: record.status === "pending_reconciliation"
      ? "文章已保存，正在等待头条草稿列表返回真实文章 ID；可稍后调用反查接口。"
      : undefined,
  };
}

function publishResultFromRecord(
  record: ToutiaoArticleRecord,
): ToutiaoPublishResult {
  return {
    draftId: record.articleId ?? record.idempotencyKey,
    status: "published",
    title: record.title,
    currentUrl: record.currentUrl ?? PUBLISH_URL,
    idempotencyKey: record.idempotencyKey,
    articleId: record.articleId,
    reconciledAt: record.reconciledAt,
  };
}

function toPlainText(value: string): string {
  return value.replaceAll(/<[^>]+>/g, " ");
}

function normalizeText(value: string): string {
  // 编辑器回读的是浏览器解码后的文本，而 HTML 源正文可能仍保留实体。
  // 先统一常见实体再折叠空白，避免“Cat &amp; Jack”被误判为正文缺失。
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    "#39": "'",
    "#x27": "'",
  };
  return value.replaceAll(
    /&(amp|lt|gt|quot|#39|#x27);/gi,
    (matched) => entities[matched.slice(1, -1).toLowerCase()] ?? matched,
  )
    // 编辑器会在窄列视觉换行处把英文单词拆成两个文本节点，例如
    // “Scin tilla”；这不代表正文丢失，回读校验应还原这类断词。
    .replaceAll(/([A-Za-z])\s+([A-Za-z])/g, "$1$2")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function imageSuffixFromContentType(contentType: string): string {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  return ".jpg";
}

async function hasVisibleLocator(
  page: Page,
  selectors: string[],
): Promise<boolean> {
  for (const selector of selectors) {
    if (await page.locator(selector).first().isVisible().catch(() => false)) {
      return true;
    }
  }
  return false;
}

function isLoginUrl(url: string): boolean {
  return url.includes("/auth/page/login") || url.includes("sso.toutiao.com") ||
    url.includes("login");
}

function sanitizeFileSegment(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
}

export function defaultProfileDir(): string {
  return join(dirname(fromFileUrl(import.meta.url)), "../../../data/toutiao");
}
