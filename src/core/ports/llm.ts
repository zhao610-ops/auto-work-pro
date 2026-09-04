export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  model?: string;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  /**
   * 单次模型调用的场景级超时。用于让可降级步骤快速失败，例如动态模板或质量审稿。
   */
  timeoutMs?: number;
  /**
   * 单次模型调用的场景级最大尝试次数。未设置时使用 provider 默认值。
   */
  maxAttempts?: number;
  stream?: boolean;
  response_format?: {
    type: "json_object" | "text";
  };
}

export interface ChatCompletionChoice {
  index?: number;
  message?: {
    role?: ChatMessage["role"];
    content?: string | null;
  };
  finish_reason?: string | null;
}

export interface ChatCompletionResponse {
  id?: string;
  model?: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface LLMProvider {
  /**
   * 初始化LLM提供者
   */
  initialize(): Promise<void>;

  /**
   * 刷新配置
   */
  refresh(): Promise<void>;

  /**
   * 设置模型
   */
  setModel(model: string): void;

  /**
   * 创建聊天完成
   * @param messages 消息数组
   * @param options 可选参数
   */
  createChatCompletion(
    messages: ChatMessage[],
    options?: ChatCompletionOptions,
  ): Promise<ChatCompletionResponse>;
}

export type LLMProviderType = "OPENAI_COMPATIBLE";
