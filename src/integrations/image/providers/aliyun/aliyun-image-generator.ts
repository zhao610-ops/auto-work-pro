import axios from "npm:axios@1.8.3";
import {
  AliTaskResponse,
  AliTaskStatusResponse,
  BaseAliyunImageGenerator,
} from "@src/integrations/image/providers/aliyun/base-aliyun-image-generator.ts";

export const ALIYUN_DEFAULT_BODY_IMAGE_MODEL = "qwen-image-2.0";
export const ALIYUN_LEGACY_BODY_IMAGE_MODEL = "wanx2.1-t2i-turbo";

export interface AliyunImageOptions {
  prompt: string;
  size?: string;
  model?: string;
}

export class AliyunImageGenerator extends BaseAliyunImageGenerator<
  AliyunImageOptions,
  string
> {
  constructor(apiKey?: string, defaultModel = ALIYUN_DEFAULT_BODY_IMAGE_MODEL) {
    super(apiKey);
    this.baseUrl =
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis";
    this.model = defaultModel;
  }

  /**
   * 生成图片
   * @param options 生成选项
   * @returns 图片URL数组
   */
  async generate(options: AliyunImageOptions): Promise<string> {
    const { prompt, size = "1024*1024" } = options;
    const model = options.model || this.model;
    if (model !== ALIYUN_LEGACY_BODY_IMAGE_MODEL) {
      return await this.generateMultimodalImage(model, prompt, {
        size,
        n: 1,
      });
    }

    try {
      const response = await this.submitTask<AliTaskResponse>({
        model,
        input: {
          prompt,
        },
        parameters: {
          size,
          n: 1,
        },
      });

      const taskId = response.output.task_id;
      return this.waitForCompletion(taskId);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `图片生成失败: ${error.response?.data?.message || error.message}`,
        );
      }
      throw error;
    }
  }

  getResult(output: AliTaskStatusResponse["output"]): string {
    if (output.results && output.results.length > 0) {
      return output.results[0].url;
    }
    throw new Error("任务成功但未获取到图片URL");
  }
}
