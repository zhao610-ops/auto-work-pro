import { dirname, fromFileUrl, join } from "jsr:@std/path@1";
import {
  type BrowserContext,
  chromium,
  type Page,
} from "npm:playwright-core@1.56.1";
import type {
  ToutiaoDraftRequest,
  ToutiaoDraftResult,
  ToutiaoRelayConfig,
  ToutiaoSessionStatus,
} from "./types.ts";

const PUBLISH_URL = "https://mp.toutiao.com/profile_v4/graphic/publish";
const LOGIN_URL = "https://mp.toutiao.com/auth/page/login/";

export class ToutiaoBrowserSession {
  private context?: BrowserContext;

  constructor(private readonly config: ToutiaoRelayConfig) {}

  async getSessionStatus(): Promise<ToutiaoSessionStatus> {
    const page = await this.newPage();
    try {
      return await this.checkLoginStatus(page);
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
    const page = await this.newPage();
    try {
      const session = await this.checkLoginStatus(page);
      if (!session.loggedIn) {
        return {
          draftId: request.idempotencyKey ?? crypto.randomUUID(),
          status: "blocked",
          title: request.title.trim(),
          currentUrl: session.currentUrl ?? page.url(),
          savedAt: new Date().toISOString(),
          idempotencyKey: request.idempotencyKey,
          reason: "今日头条账号未登录，请先调用 /api/toutiao/login 完成登录。",
        };
      }

      await page.goto(PUBLISH_URL, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await waitForEditor(page);
      await fillTitle(page, request.title.trim());
      await fillContent(page, request.contentHtml ?? request.contentText ?? "");

      const coverPath = await prepareCoverImage(request);
      if (coverPath) {
        await uploadCover(page, coverPath);
      }

      await saveDraft(page);
      const screenshotPath = await this.captureScreenshot(page, "draft-saved");
      return {
        draftId: request.idempotencyKey ?? crypto.randomUUID(),
        status: "draft",
        title: request.title.trim(),
        currentUrl: page.url(),
        savedAt: new Date().toISOString(),
        idempotencyKey: request.idempotencyKey,
        screenshotPath,
      };
    } catch (error) {
      const screenshotPath = await this.captureScreenshot(page, "draft-error")
        .catch(() => undefined);
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}${
          screenshotPath ? `；截图：${screenshotPath}` : ""
        }`,
      );
    } finally {
      await page.close().catch(() => {});
    }
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => {});
    this.context = undefined;
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
      throw new Error(
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
  if (!title) throw new Error("title 不能为空");
  if (!content) throw new Error("contentHtml 或 contentText 不能为空");
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
  );
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
  throw new Error("没有找到今日头条标题输入框");
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
  if (!inserted) throw new Error("没有找到今日头条正文编辑器");
}

async function uploadCover(page: Page, imagePath: string): Promise<void> {
  const input = page.locator("input[type='file']").first();
  if (await input.count()) {
    await input.setInputFiles(imagePath);
    await waitForUploadSettled(page);
    return;
  }

  const trigger = page.getByText(/封面|上传|添加图片/).first();
  if (await trigger.isVisible().catch(() => false)) {
    const chooserPromise = page.waitForEvent("filechooser", { timeout: 8_000 });
    await trigger.click();
    const chooser = await chooserPromise;
    await chooser.setFiles(imagePath);
    await waitForUploadSettled(page);
    return;
  }

  throw new Error("没有找到今日头条封面上传控件");
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
    throw new Error("没有找到今日头条草稿保存控件或自动保存状态");
  }

  await autoSaveCompleted.waitFor({ state: "visible", timeout: 15_000 })
    .catch(async () => {
      const stillSaving = await autoSaveStarted.isVisible().catch(() => false);
      if (stillSaving) {
        throw new Error("今日头条草稿仍在保存中，15 秒内未确认完成");
      }
      throw new Error("未识别到今日头条草稿保存完成状态");
    });
}

async function dismissOptionalDialog(page: Page): Promise<void> {
  const confirm = page.getByRole("button", { name: /确定|确认|知道了/ })
    .first();
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.click().catch(() => {});
  }
}

async function waitForUploadSettled(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => {});
  await page.waitForTimeout(1000);
}

async function prepareCoverImage(
  request: ToutiaoDraftRequest,
): Promise<string | undefined> {
  if (request.coverImagePath) return request.coverImagePath;
  if (!request.coverImageUrl) return undefined;
  const response = await fetch(request.coverImageUrl);
  if (!response.ok) {
    throw new Error(`下载封面失败：HTTP ${response.status}`);
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
