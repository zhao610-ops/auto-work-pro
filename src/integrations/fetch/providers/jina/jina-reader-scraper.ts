// Get your Jina AI API key for free: https://jina.ai/?sui=apikey

import {
  ContentScraper,
  Media,
  ScrapedContent,
  ScraperOptions,
} from "@src/core/ports/content-scraper.ts";
import { HttpClient } from "@src/utils/http/http-client.ts";
import { z } from "npm:zod@3.25.76";

// Define a schema for the Jina API response for stricter parsing.
const JinaResponseSchema = z.object({
  code: z.number(),
  status: z.number().optional(), // sometimes not present
  data: z.object({
    url: z.string(),
    title: z.string(),
    content: z.string(),
    images: z.array(z.object({
      src: z.string(),
      alt: z.string().optional(),
    })).optional(),
    videos: z.array(z.object({
      src: z.string(),
      alt: z.string().optional(),
    })).optional(),
    // Add other fields from Jina response if needed
  }),
  usage: z.object({
    total_tokens: z.number(),
  }).optional(), // sometimes not present
  message: z.string().optional(), // present on errors
});

export class JinaScraper implements ContentScraper {
  private apiKey = "";
  private jinaApiUrl = "https://r.jina.ai/";

  constructor(
    private readonly configuredApiKey?: string,
    private readonly httpClient = HttpClient.getInstance(),
  ) {}

  async refresh(): Promise<void> {
    this.apiKey = this.configuredApiKey ?? "";
    if (!this.apiKey) {
      throw new Error(
        "providers.fetch.jina.apiKey is not set. " +
          "Get your Jina AI API key for free: https://jina.ai/?sui=apikey",
      );
    }
  }

  async scrape(
    sourceId: string, // This will be the URL to scrape
    options?: ScraperOptions,
  ): Promise<ScrapedContent[]> {
    await this.refresh();
    console.info(
      `[JinaScraper] Scraping URL: ${sourceId} with options: ${
        JSON.stringify(options)
      }`,
    );

    try {
      const result = await this.httpClient.request<unknown>(
        this.jinaApiUrl + sourceId,
        { // Jina Reader API uses GET with URL in path
          method: "GET", // Changed from POST to GET as per Jina Reader API docs (https://jina.ai/reader)
          headers: {
            "Authorization": `Bearer ${this.apiKey}`,
            "Accept": "application/json",
            // "X-With-Images-Summary": "true", // Example of an optional header
          },
          retries: 1,
          timeout: 45000,
        },
      );

      // Validate the response structure
      const parsedResult = JinaResponseSchema.safeParse(result);

      if (!parsedResult.success) {
        console.error(
          `[JinaScraper] Invalid API response structure: ${parsedResult.error.toString()}`,
          result,
        );
        throw new Error(
          `Jina API returned an invalid response structure. ${parsedResult.error.toString()}`,
        );
      }

      const jinaData = parsedResult.data.data;

      const media: Media[] = [];
      if (jinaData.images) {
        jinaData.images.forEach((img) => {
          media.push({
            url: img.src,
            type: "image",
            // Jina API doesn't provide size directly, so we omit it or set default
            size: { width: 0, height: 0 },
          });
        });
      }
      // TODO: Add similar mapping for videos if needed

      const scrapedContent: ScrapedContent = {
        id: sourceId, // Using the URL as the ID
        title: jinaData.title,
        content: jinaData.content,
        url: jinaData.url, // Jina provides the original URL back
        publishDate: new Date().toISOString(), // Jina doesn't provide a publish date
        media: media,
        metadata: {
          // Store any other relevant data from Jina's response
          usage: parsedResult.data.usage,
        },
      };

      return [scrapedContent]; // The interface expects an array
    } catch (error) {
      console.error(`[JinaScraper] Error scraping ${sourceId}:`, error);
      // Optionally, re-throw or return an empty array or specific error structure
      if (error instanceof Error) {
        throw new Error(
          `Failed to scrape ${sourceId} using Jina: ${error.message}`,
        );
      }
      throw new Error(`Failed to scrape ${sourceId} using Jina: Unknown error`);
    }
  }
}
