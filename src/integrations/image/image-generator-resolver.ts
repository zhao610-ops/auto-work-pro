import { imageGeneratorRegistry } from "@src/integrations/image/image-generator-registry.ts";
import {
  ImageGenerator,
  ImageGeneratorType,
} from "@src/core/ports/image-generator.ts";
import type { ResolvedTrendPublishConfig } from "@src/utils/config/define-config.ts";
import { TextLogoGenerator } from "@src/integrations/image/providers/text-logo-generator.ts";
import { AliyunImageGenerator } from "@src/integrations/image/providers/aliyun/aliyun-image-generator.ts";
import { AliyunPosterImageGenerator } from "@src/integrations/image/providers/aliyun/aliyun-poster-image-generator.ts";
import { MiniMaxImageGenerator } from "@src/integrations/image/providers/minimax/minimax-image-generator.ts";

export interface ImageGeneratorTypeMap {
  [ImageGeneratorType.TEXT_LOGO]: TextLogoGenerator;
  [ImageGeneratorType.ALIYUN_IMAGE]: AliyunImageGenerator;
  [ImageGeneratorType.ALIYUN_POSTER]: AliyunPosterImageGenerator;
  [ImageGeneratorType.MINIMAX_IMAGE]: MiniMaxImageGenerator;
}

/**
 * 图片生成器解析器，负责按类型创建、缓存并刷新图片生成 provider。
 */
export class ImageGeneratorResolver {
  private generators: Map<ImageGeneratorType, ImageGenerator> = new Map();

  constructor(private readonly config?: ResolvedTrendPublishConfig) {}

  /**
   * 获取指定类型的图片生成器
   * @param type 生成器类型
   * @param needRefresh 是否需要刷新配置
   * @returns 图片生成器实例
   */
  public async getGenerator<T extends ImageGeneratorType>(
    type: T,
    needRefresh: boolean = true,
  ): Promise<ImageGeneratorTypeMap[T]> {
    // 如果已经创建过该类型的生成器，且不需要刷新，直接返回
    if (this.generators.has(type) && !needRefresh) {
      return this.generators.get(type)! as ImageGeneratorTypeMap[T];
    }

    // 如果需要刷新且生成器存在，先刷新配置
    if (needRefresh && this.generators.has(type)) {
      await this.generators.get(type)!.refresh();
      return this.generators.get(type)! as ImageGeneratorTypeMap[T];
    }

    const generator = imageGeneratorRegistry.get(type).create({
      config: this.config,
    });

    // 初始化生成器
    await generator.initialize();
    this.generators.set(type, generator);
    return generator as ImageGeneratorTypeMap[T];
  }

  /**
   * 刷新所有生成器的配置
   */
  public async refreshAllGenerators(): Promise<void> {
    const refreshPromises: Promise<void>[] = [];

    for (const [type, generator] of this.generators.entries()) {
      refreshPromises.push(
        generator.refresh().catch((error) => {
          console.error(`刷新图片生成器配置失败 [${type}]:`, error);
        }),
      );
    }

    await Promise.allSettled(refreshPromises);
  }
}
