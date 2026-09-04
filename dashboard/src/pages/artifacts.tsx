import { useEffect, useMemo, useState } from "react";
import { Drawer } from "@mantine/core";
import { FileJson, FileText, Image as ImageIcon } from "lucide-react";
import { apiArtifact } from "../api/client.ts";
import type { ArticleRunDetail, ArtifactRef } from "../api/types.ts";
import { Badge, Button, Card, EmptyState } from "../components/ui.tsx";

function collectArtifacts(run: ArticleRunDetail | null): ArtifactRef[] {
  if (!run) return [];
  const byKey = new Map<string, ArtifactRef>();
  for (const artifact of run.artifacts ?? []) {
    byKey.set(artifact.key, artifact);
  }
  for (const step of run.steps ?? []) {
    for (const artifact of step.inputArtifacts ?? []) {
      byKey.set(artifact.key, artifact);
    }
    for (const artifact of step.outputArtifacts ?? []) {
      byKey.set(artifact.key, artifact);
    }
  }
  return [...byKey.values()];
}

function formatSize(size?: number) {
  if (!size) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function artifactIcon(contentType: string) {
  if (contentType.includes("image/")) return <ImageIcon className="size-4" />;
  if (contentType.includes("json")) return <FileJson className="size-4" />;
  return <FileText className="size-4" />;
}

function prettyJson(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export function ArtifactsPanel(
  {
    run,
    onPreviewArtifact,
  }: {
    run: ArticleRunDetail | null;
    onPreviewArtifact: (artifact: ArtifactRef) => void;
  },
) {
  const artifacts = useMemo(() => collectArtifacts(run), [run]);
  const grouped = {
    html: artifacts.filter((item) => item.contentType.includes("html")),
    json: artifacts.filter((item) => item.contentType.includes("json")),
    images: artifacts.filter((item) => item.contentType.includes("image/")),
    other: artifacts.filter((item) =>
      !item.contentType.includes("html") &&
      !item.contentType.includes("json") &&
      !item.contentType.includes("image/")
    ),
  };

  return (
    <Card>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="tp-title text-base font-semibold">产物库</h2>
          <p className="tp-muted mt-1 text-sm">
            当前运行生成的正文 HTML、配置快照、质量报告、图片和发布结果。
          </p>
        </div>
        <Badge>{artifacts.length} artifacts</Badge>
      </div>

      {artifacts.length
        ? (
          <div className="space-y-5">
            {Object.entries(grouped).map(([group, items]) =>
              items.length
                ? (
                  <section key={group}>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--tp-subtle)]">
                      {group}
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {items.map((artifact) => (
                        <button
                          key={artifact.key}
                          type="button"
                          onClick={() => onPreviewArtifact(artifact)}
                          className="tp-section flex min-h-28 flex-col justify-between rounded-lg border p-3 text-left transition hover:bg-[#f8fafc]"
                        >
                          <div className="flex items-start gap-3">
                            <div className="grid size-8 shrink-0 place-items-center rounded-md bg-[#eff6ff] text-[#2563eb]">
                              {artifactIcon(artifact.contentType)}
                            </div>
                            <div className="min-w-0">
                              <div className="tp-title truncate text-sm font-semibold">
                                {artifact.label ??
                                  artifact.key.split("/").pop()}
                              </div>
                              <div className="tp-muted mt-1 line-clamp-2 text-xs">
                                {artifact.key}
                              </div>
                            </div>
                          </div>
                          <div className="tp-muted mt-4 flex items-center justify-between gap-3 text-xs">
                            <span className="truncate">
                              {artifact.contentType}
                            </span>
                            <span>{formatSize(artifact.size)}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </section>
                )
                : null
            )}
          </div>
        )
        : <EmptyState>当前运行还没有可预览产物</EmptyState>}
    </Card>
  );
}

export function ArtifactPreview(
  {
    artifact,
    apiKey,
    onClose,
  }: {
    artifact: ArtifactRef | null;
    apiKey: string;
    onClose: () => void;
  },
) {
  const [content, setContent] = useState<string>("");
  const [objectUrl, setObjectUrl] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!artifact) return;
    let nextObjectUrl = "";
    setLoading(true);
    setError("");
    setContent("");
    setObjectUrl("");
    apiArtifact(
      `/api/artifacts?key=${encodeURIComponent(artifact.key)}`,
      apiKey,
    )
      .then(async (response) => {
        const blob = await response.blob();
        if (artifact.contentType.includes("image/")) {
          nextObjectUrl = URL.createObjectURL(blob);
          setObjectUrl(nextObjectUrl);
          return;
        }
        setContent(await blob.text());
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err))
      )
      .finally(() => setLoading(false));
    return () => {
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
    };
  }, [artifact, apiKey]);

  const isHtml = artifact?.contentType.includes("html") ?? false;
  const isJson = artifact?.contentType.includes("json") ?? false;
  const isImage = artifact?.contentType.includes("image/") ?? false;

  return (
    <Drawer
      opened={Boolean(artifact)}
      onClose={onClose}
      title={artifact?.label ?? artifact?.key ?? "产物预览"}
      position="right"
      size="calc(100vw - 64px)"
      overlayProps={{ blur: 3 }}
    >
      {artifact && (
        <div className="flex h-[calc(100vh-96px)] min-h-0 flex-col">
          <div className="tp-muted mb-3 truncate text-xs">
            {artifact.contentType} · {artifact.key}
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded-md bg-[#f8fafc] p-3">
            {loading && <EmptyState>正在加载产物...</EmptyState>}
            {error && (
              <div className="tp-danger rounded-md border p-3 text-sm">
                {error}
              </div>
            )}
            {!loading && !error && isImage && objectUrl && (
              <img
                className="mx-auto max-h-full max-w-full rounded-md border border-[#e2e8f0] bg-[#ffffff] object-contain"
                src={objectUrl}
                alt={artifact.label ?? artifact.key}
              />
            )}
            {!loading && !error && isHtml && content && (
              <iframe
                className="h-full min-h-[74vh] w-full rounded-md border border-[#e2e8f0] bg-white"
                srcDoc={content}
                title={artifact.label ?? artifact.key}
                sandbox=""
              />
            )}
            {!loading && !error && !isImage && !isHtml && (
              <pre className="tp-code min-h-[74vh] overflow-auto rounded-md border p-4 text-xs leading-5">
                {isJson ? prettyJson(content) : content}
              </pre>
            )}
          </div>
          <div className="mt-3 flex justify-end">
            <Button variant="ghost" onClick={onClose}>关闭</Button>
          </div>
        </div>
      )}
    </Drawer>
  );
}
