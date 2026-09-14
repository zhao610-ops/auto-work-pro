import { dirname, resolve } from "node:path";
import { ImageGeneratorType } from "@src/core/ports/image-generator.ts";
import { WeixinArticleCoverService } from "@src/features/weixin-article/services/article-cover.service.ts";
import { ImageGeneratorResolver } from "@src/integrations/image/image-generator-resolver.ts";
import {
  initializeAppConfig,
  parseConfigArgs,
} from "@src/utils/config/app-config.ts";

interface PreviewOptions {
  title: string;
  output: string;
}

const { configPath, args } = parseConfigArgs(Deno.args);
const options = parsePreviewOptions(args);
const config = await initializeAppConfig({ configPath });
const cover = config.features.article.cover;
const imageGeneratorType = cover.provider === "minimax"
  ? ImageGeneratorType.MINIMAX_IMAGE
  : ImageGeneratorType.ALIYUN_POSTER;
const outputPath = resolve(options.output);

await Deno.mkdir(dirname(outputPath), { recursive: true });

const service = new WeixinArticleCoverService(
  {
    uploadImage: async (imageUrl: string) => {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`下载封面预览失败: HTTP ${response.status}`);
      }
      await Deno.writeFile(
        outputPath,
        new Uint8Array(await response.arrayBuffer()),
      );
      return "preview-only";
    },
  },
  new ImageGeneratorResolver(config),
  config.features.article.renderer.promptProfile,
  cover.model,
  imageGeneratorType,
);

const result = await service.generateCover(options.title);
if (!result.generated) {
  throw new Error(result.error ?? "封面预览生成失败");
}

console.log(`封面预览已生成（未上传微信）：${outputPath}`);

function parsePreviewOptions(args: string[]): PreviewOptions {
  let title = "ChatGPT成为新一代商品发现入口";
  let output = "src/temp/cover-preview.png";

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--title") {
      if (!next) throw new Error("--title 需要提供文章标题");
      title = next;
      index++;
      continue;
    }
    if (arg === "--output") {
      if (!next) throw new Error("--output 需要提供文件路径");
      output = next;
      index++;
      continue;
    }
    throw new Error(`未知参数: ${arg}`);
  }

  return { title, output };
}
