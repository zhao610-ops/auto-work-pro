import type {
  ArtifactRef,
  ArtifactStore,
} from "@src/core/ports/artifact-store.ts";

export class WeixinArticleDryRunOutputService {
  constructor(private readonly artifactStore: ArtifactStore) {}

  public async writeHtml(
    runId: string,
    renderedTemplate: string,
  ): Promise<ArtifactRef> {
    return await this.artifactStore.putText(
      this.artifactStore.createRunKey(runId, "dry-run-preview", "html"),
      wrapPreviewHtml(renderedTemplate),
      {
        label: "Dry-run HTML 预览",
        contentType: "text/html; charset=utf-8",
      },
    );
  }
}

function wrapPreviewHtml(content: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>微信文章 Dry Run</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
    }
  </style>
</head>
<body>
${content}
</body>
</html>`;
}
