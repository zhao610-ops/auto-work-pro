import {
  ContentScraper,
  Media,
  ScrapedContent,
  ScraperOptions,
} from "@src/core/ports/content-scraper.ts";
import { ConfigurationError } from "@src/utils/config/app-config.ts";
import type { ResolvedTrendPublishConfig } from "@src/utils/config/define-config.ts";
import { formatDate } from "@src/utils/common.ts";
import { HttpClient } from "@src/utils/http/http-client.ts";
import { Logger } from "@zilla/logger";

const logger = new Logger("twitter-scraper");
const DEFAULT_TWEET_LIMIT = 20;
const XQUIK_API_CONTRACT = "2026-04-29";

interface TweetMediaSize {
  w?: number;
  h?: number;
}

interface TweetMedia {
  media_url_https?: string;
  mediaUrl?: string;
  url?: string;
  type?: string;
  sizes?: {
    large?: TweetMediaSize;
  };
}

interface TweetRecord {
  id?: string;
  text?: string;
  url?: string;
  createdAt?: string;
  extendedEntities?: {
    media?: TweetMedia[];
  };
  media?: TweetMedia[];
  quoted_tweet?: TweetRecord;
}

interface TweetSearchResponse {
  tweets?: TweetRecord[];
}

export class TwitterScraper implements ContentScraper {
  private xApiBearerToken: string | undefined;
  private xquikApiKey: string | undefined;

  constructor(
    private readonly configuredProvider?: ResolvedTrendPublishConfig[
      "providers"
    ]["fetch"]["twitter"],
    private readonly httpClient = HttpClient.getInstance(),
  ) {}

  async refresh(): Promise<void> {
    const startTime = Date.now();
    const provider = this.configuredProvider;
    this.xApiBearerToken = provider?.bearerToken ||
      undefined;
    this.xquikApiKey = provider?.xquikApiKey || undefined;

    if (!this.xApiBearerToken && !this.xquikApiKey) {
      throw new ConfigurationError(
        "Configure providers.fetch.twitter.bearerToken or providers.fetch.twitter.xquikApiKey for Twitter scraping",
      );
    }

    logger.debug(
      `TwitterScraper 初始化完成, 耗时: ${Date.now() - startTime}ms`,
    );
  }

  async scrape(
    sourceId: string,
    options?: ScraperOptions,
  ): Promise<ScrapedContent[]> {
    await this.refresh();
    const usernameMatch = sourceId.match(/x\.com\/([^\/]+)/);
    if (!usernameMatch) {
      throw new Error("Invalid Twitter source ID format");
    }

    const username = usernameMatch[1];
    logger.debug(`Processing Twitter user: ${username}`);

    try {
      const query = `from:${username} -filter:replies within_time:24h`;
      const limit = options?.limit ?? DEFAULT_TWEET_LIMIT;
      const tweets = await this.fetchTweets(query, limit);
      const scrapedContent: ScrapedContent[] = tweets
        .slice(0, limit)
        .map((tweet) => {
          const quotedContent = this.getQuotedContent(tweet.quoted_tweet);
          let media = this.getMediaList(tweet);
          // 合并tweet和quotedContent 如果quotedContent存在，则将quotedContent的内容添加到tweet的内容中
          const tweetText = tweet.text ?? "";
          const content = quotedContent
            ? `${tweetText}\n\n 【QuotedContent:${quotedContent.content}】`
            : tweetText;
          // 合并media和quotedContent的media
          if (quotedContent?.media) {
            media = [...media, ...quotedContent.media];
          }
          return {
            id: tweet.id ?? "",
            title: tweetText.split("\n")[0],
            content: content,
            url: tweet.url ?? this.getTweetUrl(username, tweet.id),
            publishDate: tweet.createdAt ? formatDate(tweet.createdAt) : "",
            media: media,
            metadata: {
              platform: "twitter",
              username,
            },
          } as ScrapedContent;
        });

      if (scrapedContent.length > 0) {
        logger.debug(
          `Successfully fetched ${scrapedContent.length} tweets from ${username}`,
        );
      } else {
        logger.debug(`No tweets found for ${username}`);
      }

      logger.debug("scrapedContent", JSON.stringify(scrapedContent, null, 2));

      return scrapedContent;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Error fetching tweets for ${username}:`, errorMsg);
      throw error;
    }
  }

  private async fetchTweets(
    query: string,
    limit: number,
  ): Promise<TweetRecord[]> {
    if (this.xApiBearerToken) {
      try {
        return await this.fetchTwitterApiTweets(query);
      } catch (error) {
        if (!this.xquikApiKey) {
          throw error;
        }
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.warn(
          "TwitterAPI.io request failed, falling back to Xquik:",
          errorMsg,
        );
      }
    }

    if (this.xquikApiKey) {
      return await this.fetchXquikTweets(query, limit);
    }

    throw new ConfigurationError(
      "Configure providers.fetch.twitter.bearerToken or providers.fetch.twitter.xquikApiKey for Twitter scraping",
    );
  }

  private async fetchTwitterApiTweets(query: string): Promise<TweetRecord[]> {
    const apiUrl =
      `https://api.twitterapi.io/twitter/tweet/advanced_search?query=${
        encodeURIComponent(
          query,
        )
      }&queryType=Top`;

    const tweets = await this.httpClient.request<TweetSearchResponse>(apiUrl, {
      headers: {
        "X-API-Key": `${this.xApiBearerToken}`,
      },
      retries: 1,
      timeout: 30000,
    });
    return tweets.tweets ?? [];
  }

  private async fetchXquikTweets(
    query: string,
    limit: number,
  ): Promise<TweetRecord[]> {
    const apiUrl = new URL("https://xquik.com/api/v1/x/tweets/search");
    apiUrl.searchParams.set("q", query);
    apiUrl.searchParams.set("queryType", "Top");
    apiUrl.searchParams.set("limit", String(limit));

    const tweets = await this.httpClient.request<TweetSearchResponse>(
      apiUrl.toString(),
      {
        headers: {
          "x-api-key": `${this.xquikApiKey}`,
          "xquik-api-contract": XQUIK_API_CONTRACT,
        },
        retries: 1,
        timeout: 30000,
      },
    );
    return tweets.tweets ?? [];
  }

  private getMediaList(tweet: TweetRecord): Media[] {
    const mediaList: Media[] = [];
    const tweetMedia = [
      ...(tweet.extendedEntities?.media ?? []),
      ...(tweet.media ?? []),
    ];

    for (const media of tweetMedia) {
      const mediaUrl = media.media_url_https ?? media.mediaUrl ?? media.url;
      if (!mediaUrl) {
        continue;
      }

      mediaList.push({
        url: mediaUrl,
        type: media.type ?? "photo",
        size: {
          width: media.sizes?.large?.w ?? 0,
          height: media.sizes?.large?.h ?? 0,
        },
      });
    }

    return mediaList;
  }

  private getQuotedContent(quoted_tweet?: TweetRecord): ScrapedContent | null {
    if (quoted_tweet) {
      const tweetText = quoted_tweet.text ?? "";
      return {
        id: quoted_tweet.id ?? "",
        title: tweetText.split("\n")[0],
        content: tweetText,
        url: quoted_tweet.url ?? "",
        publishDate: quoted_tweet.createdAt
          ? formatDate(quoted_tweet.createdAt)
          : "",
        media: this.getMediaList(quoted_tweet),
        metadata: {
          platform: "twitter",
        },
      };
    }
    return null;
  }

  private getTweetUrl(username: string, tweetId?: string): string {
    if (!tweetId) {
      return "";
    }
    return `https://x.com/${username}/status/${tweetId}`;
  }
}
