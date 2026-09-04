import ejs from "npm:ejs@3.1.10";
import { Logger } from "@zilla/logger";

const logger = new Logger("base-template-renderer");

/**
 * 基础模板渲染器类
 */
export abstract class BaseTemplateRenderer<T extends ejs.Data> {
  protected templates: { [key: string]: string } = {};
  protected availableTemplates: string[] = [];
  protected templatePrefix: string;

  constructor(
    templatePrefix: string,
    private readonly defaultTemplateType?: string,
  ) {
    this.templatePrefix = templatePrefix;
    // 初始化时异步加载模板
    this.initializeTemplates();
  }

  /**
   * 初始化并加载模板
   */
  public async initializeTemplates(): Promise<void> {
    try {
      await this.loadTemplates();
    } catch (error) {
      logger.error("模板加载失败:", error);
      throw error;
    }
  }

  /**
   * 加载模板文件
   */
  protected abstract loadTemplates(): Promise<void>;

  /**
   * 从配置中获取模板类型
   * @returns 配置的模板类型或默认值
   */
  protected async getTemplateTypeFromConfig(): Promise<string> {
    const configValue = this.defaultTemplateType ?? this.availableTemplates[0];
    if (configValue === "random") {
      return this.getRandomTemplateType();
    }
    return configValue;
  }

  /**
   * 随机选择一个模板类型
   * @returns 随机选择的模板类型
   */
  protected getRandomTemplateType(): string {
    const randomIndex = Math.floor(
      Math.random() * this.availableTemplates.length,
    );
    return this.availableTemplates[randomIndex];
  }

  protected abstract doRender(
    data: T,
    template: string,
    context?: unknown,
  ): Promise<string>;

  /**
   * 渲染模板
   * @param data 渲染数据
   * @param templateType 模板类型，或者 'config'（从配置获取）或 'random'（随机选择）
   * @returns 渲染后的 HTML
   */
  public async render(
    data: T,
    templateType?: string,
    context?: unknown,
  ): Promise<string> {
    try {
      let finalTemplateType: string;

      // 如果没有传templateType，从配置获取
      if (!templateType) {
        finalTemplateType = await this.getTemplateTypeFromConfig();
      } else if (templateType === "random") {
        // 如果指定random，随机选择模板
        finalTemplateType = this.getRandomTemplateType();
      } else {
        // 检查指定的模板是否存在
        if (!this.availableTemplates.includes(templateType)) {
          throw new Error(
            `Template type '${templateType}' not found for ${this.templatePrefix}`,
          );
        }
        finalTemplateType = templateType;
      }

      logger.info(`使用${this.templatePrefix}模板: ${finalTemplateType}`);

      const template = this.templates[finalTemplateType];
      if (!template) {
        throw new Error(
          `Template '${finalTemplateType}' not found for ${this.templatePrefix}`,
        );
      }

      // 使用 EJS 渲染模板
      return await this.doRender(data, template, context);
    } catch (error) {
      logger.error("模板渲染失败:", error);
      throw error;
    }
  }
}
