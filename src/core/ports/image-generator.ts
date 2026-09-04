/**
 * 图片生成器接口
 */
import { Buffer } from "node:buffer";

export type ImageGenerationRequest = Record<string, unknown>;
export type ImageGenerationResult = Buffer | string;

export interface ImageGenerator<
  TRequest = never,
  TResult extends ImageGenerationResult = ImageGenerationResult,
> {
  /**
   * 初始化生成器
   */
  initialize(): Promise<void>;

  /**
   * 刷新配置
   */
  refresh(): Promise<void>;

  /**
   * 生成图片
   * @param options 生成选项
   * @returns 生成结果（可能是Buffer或URL）
   */
  generate(options: TRequest): Promise<TResult>;

  /**
   * 将生成的图片保存到文件
   * @param options 生成选项
   * @param outputPath 输出路径
   */
  saveToFile(
    options: TRequest,
    outputPath: string,
  ): Promise<void>;
}

/**
 * 图片生成器类型
 */
export enum ImageGeneratorType {
  TEXT_LOGO = "TEXT_LOGO",
  ALIYUN_IMAGE = "ALIYUN_IMAGE",
  ALIYUN_POSTER = "ALIYUN_POSTER",
  MINIMAX_IMAGE = "MINIMAX_IMAGE",
}
