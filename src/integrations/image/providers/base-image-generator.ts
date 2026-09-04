import {
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageGenerator,
} from "@src/core/ports/image-generator.ts";
import { Buffer } from "node:buffer";
import fs from "node:fs/promises";

/**
 * 图片生成器基础抽象类
 */
export abstract class BaseImageGenerator<
  TRequest = ImageGenerationRequest,
  TResult extends ImageGenerationResult = ImageGenerationResult,
> implements ImageGenerator<TRequest, TResult> {
  constructor() {}

  /**
   * 初始化生成器
   */
  async initialize(): Promise<void> {
    await this.refresh();
  }

  /**
   * 刷新配置
   */
  abstract refresh(): Promise<void>;

  /**
   * 生成图片
   * @param options 生成选项
   */
  abstract generate(
    options: TRequest,
  ): Promise<TResult>;

  /**
   * 将生成的图片保存到文件
   * @param options 生成选项
   * @param outputPath 输出路径
   */
  async saveToFile(
    options: TRequest,
    outputPath: string,
  ): Promise<void> {
    const result = await this.generate(options);

    if (Buffer.isBuffer(result)) {
      await fs.writeFile(outputPath, result);
    } else if (typeof result === "string") {
      // 如果是URL，需要下载图片
      throw new Error("保存URL类型的图片尚未实现");
    } else if (Array.isArray(result)) {
      throw new Error("保存多个图片URL尚未实现");
    }
  }
}
