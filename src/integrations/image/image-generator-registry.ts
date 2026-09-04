import {
  ProviderAdapter,
  ProviderCreateContext,
  ProviderRegistry,
} from "@src/registry/provider-registry.ts";
import {
  ImageGenerator,
  ImageGeneratorType,
} from "@src/core/ports/image-generator.ts";
import { TextLogoGenerator } from "@src/integrations/image/providers/text-logo-generator.ts";
import { AliyunImageGenerator } from "@src/integrations/image/providers/aliyun/aliyun-image-generator.ts";
import { AliyunPosterImageGenerator } from "@src/integrations/image/providers/aliyun/aliyun-poster-image-generator.ts";
import { MiniMaxImageGenerator } from "@src/integrations/image/providers/minimax/minimax-image-generator.ts";
import { ResolvedTrendPublishConfig } from "@src/utils/config/define-config.ts";

export interface ImageGeneratorAdapter
  extends ProviderAdapter<ResolvedTrendPublishConfig, ImageGeneratorType> {
  kind: "image";
  create(
    context?: ProviderCreateContext<ResolvedTrendPublishConfig>,
  ): ImageGenerator;
}

export const imageGeneratorRegistry = new ProviderRegistry<
  ResolvedTrendPublishConfig,
  ImageGeneratorAdapter
>();

imageGeneratorRegistry.register({
  id: ImageGeneratorType.TEXT_LOGO,
  kind: "image",
  isConfigured: () => true,
  create: () => new TextLogoGenerator(),
});

imageGeneratorRegistry.register({
  id: ImageGeneratorType.ALIYUN_IMAGE,
  kind: "image",
  isConfigured: (config) => Boolean(config.providers.image.dashscope.apiKey),
  create: (context) =>
    new AliyunImageGenerator(
      context?.config?.providers.image.dashscope.apiKey,
    ),
});

imageGeneratorRegistry.register({
  id: ImageGeneratorType.ALIYUN_POSTER,
  kind: "image",
  isConfigured: (config) => Boolean(config.providers.image.dashscope.apiKey),
  create: (context) =>
    new AliyunPosterImageGenerator(
      context?.config?.providers.image.dashscope.apiKey,
    ),
});

imageGeneratorRegistry.register({
  id: ImageGeneratorType.MINIMAX_IMAGE,
  kind: "image",
  isConfigured: (config) => Boolean(config.providers.image.minimax.apiKey),
  create: (context) =>
    new MiniMaxImageGenerator(
      context?.config?.providers.image.minimax.apiKey,
      context?.config?.providers.image.minimax.apiHost,
    ),
});
