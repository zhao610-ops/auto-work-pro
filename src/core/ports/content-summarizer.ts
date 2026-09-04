export interface ContentSummarizer {
  summarize(
    content: string,
    options?: Record<string, unknown>,
  ): Promise<Summary>;
  generateTitle(
    content: string,
    options?: Record<string, unknown>,
  ): Promise<string>;
}

export interface Summary {
  title: string;
  content: string;
  keywords?: string[];
}
