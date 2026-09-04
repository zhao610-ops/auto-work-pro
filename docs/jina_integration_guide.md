# Jina AI Integration Guide

This document provides a brief overview of how Jina AI is integrated into this
project and how to use the Jina-powered components.

## Overview

Jina AI is utilized to provide advanced functionalities such as:

- **Web Scraping**: Using the Jina Reader API to fetch and parse content from
  web pages.
- **Keyword Search**: Using Jina Search (`s.jina.ai`) to discover candidate
  articles from query strings.
- **Deep Search**: Leveraging the Jina DeepSearch API for comprehensive,
  intelligent search capabilities.
- **Text Embeddings**: Generating vector embeddings for text using the Jina
  Embeddings API.
- **Search Result Reranking**: Improving the relevance of search results using
  the Jina Reranker API.

## Prerequisites

Jina Reader, Search and DeepSearch all use `providers.fetch.jina.apiKey` in
`trendpublish.config.ts`.

```ts
providers: {
  fetch: {
    jina: {
      apiKey: "your_actual_api_key_here",
    },
  },
}
```

You can obtain a free API key from the
[Jina AI Website](https://jina.ai/?sui=apikey). Please refer to the main
`README.md` and `trendpublish.config.example.ts` for configuration details.

## Components

### 1. Web Scraper (JinaReader)

- **Class**: `JinaScraper`
- **Location**: `src/integrations/fetch/providers/jina/jina-reader-scraper.ts`
- **API Used**: Jina Reader API (`r.jina.ai`)
- **Description**: Fetches content from a given URL.
- **Usage**: Can be instantiated via `scraperRegistry` or directly. Implements
  the `ContentScraper` interface.

### 2. Keyword Search Scraper (JinaSearch)

- **Class**: `JinaSearchScraper`
- **Location**: `src/integrations/fetch/providers/jina/jina-search-scraper.ts`
- **API Used**: Jina Search API (`s.jina.ai`)
- **Description**: Searches the web from a keyword query and returns candidate
  `ScrapedContent` items. Article sources can use `search:your query` with a
  `fetchGroups.search = ["jina-search"]` route.

### 3. Deep Search Scraper (JinaDeepSearch)

- **Class**: `JinaDeepSearchScraper`
- **Location**:
  `src/integrations/fetch/providers/jina/jina-deepsearch-scraper.ts`
- **API Used**: Jina DeepSearch API (`deepsearch.jina.ai`)
- **Description**: Performs a deep search based on a query string and returns a
  synthesized answer along with source URLs.
- **Usage**: Can be instantiated via `scraperRegistry` or directly. Implements
  the `ContentScraper` interface.

### 4. Embedding Provider (JinaEmbeddings)

- **Class**: `JinaEmbeddingProvider`
- **Location**:
  `src/integrations/vector/providers/jina/jina-embedding-provider.ts`
- **API Used**: Jina Embeddings API (`api.jina.ai/v1/embeddings`)
- **Description**: Generates numerical vector representations (embeddings) for
  input text.
- **Usage**: Can be instantiated via `EmbeddingProviderResolver` or directly.
  Implements the `EmbeddingProvider` interface. Different Jina embedding models
  can be specified.

### 5. Reranker Provider (JinaReranker)

- **Class**: `JinaRerankerProvider`
- **Location**:
  `src/integrations/vector/providers/jina/jina-reranker-provider.ts`
- **API Used**: Jina Reranker API (`api.jina.ai/v1/rerank`)
- **Description**: Reranks a list of documents based on their relevance to a
  given query.
- **Usage**: Can be instantiated directly. Implements the `RerankerProvider`
  interface. Different Jina reranker models can be specified.

## Configuration

Most Jina components are configured at instantiation, often by specifying the
Jina model to use (e.g., for embeddings or reranking). The API key is read from
the typed project config.

## Further Information

For more detailed information on Jina AI APIs and their capabilities, please
refer to the [official Jina AI documentation](https://docs.jina.ai/).
