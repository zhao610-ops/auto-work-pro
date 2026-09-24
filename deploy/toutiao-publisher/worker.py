#!/usr/bin/env python3
"""独立头条发布器：读取主系统产物，不参与抓取和写作。"""

from __future__ import annotations

import hashlib
import html as html_module
import ipaddress
import json
import logging
import os
import re
import socket
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

sys.path.insert(0, "/opt/toutiao-publisher/upstream")
from toutiao_accounts import AccountStore  # noqa: E402
from toutiao_protocol import PublisherError, ToutiaoProtocolClient  # noqa: E402

LOG = logging.getLogger("toutiao-outbox")
UPSTREAM = Path(os.getenv("TOUTIAO_SOURCE_RUNS_DIR", "/input/runs"))
OUTBOX = Path(os.getenv("TOUTIAO_OUTBOX_DIR", "/data/outbox"))
STATE = Path(os.getenv("TOUTIAO_STATE_DIR", "/data/state"))
CONFIG = Path(os.getenv("TOUTIAO_CONFIG", "/data/config.toml"))
ACCOUNT_TENANT_ID = os.getenv("TOUTIAO_ACCOUNT_TENANT_ID", "").strip()
SCHEDULE = os.getenv("TOUTIAO_SCHEDULE_TIME", "11:00")
POLL_SECONDS = max(30, int(os.getenv("TOUTIAO_POLL_SECONDS", "60")))
MAX_ARTICLE_AGE_SECONDS = max(60, int(os.getenv("TOUTIAO_MAX_ARTICLE_AGE_MINUTES", "720"))) * 60
PUBLISH_ENABLED = os.getenv("TOUTIAO_PUBLISH_ENABLED", "false").lower() == "true"
DAILY_LEDGER = STATE / "published-days.json"
MAX_BODY_IMAGE_BYTES = 10 * 1024 * 1024
MAX_BODY_IMAGES = 6


@dataclass
class ExternalArticle:
    title: str
    summary: str
    body_html: str
    tags: list[str]
    topic: str


TOUTIAO_IMAGE_HOST_SUFFIXES = (
    ".toutiao.com",
    ".toutiaoimg.com",
    ".pstatp.com",
    ".byteimg.com",
)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def now_beijing() -> datetime:
    return datetime.now().astimezone()


def article_run() -> Path | None:
    candidates = []
    for path in UPSTREAM.iterdir() if UPSTREAM.is_dir() else []:
        title = path / "18-final-title.json"
        html = path / "19-final-article.html"
        if not html.exists():
            html = path / "16-revised-article-round-1.html"
        if title.exists() and html.exists() and (path / "11-cover.json").exists():
            candidates.append((title.stat().st_mtime, path))
    if not candidates:
        return None
    modified_at, latest = max(candidates)
    if time.time() - modified_at > MAX_ARTICLE_AGE_SECONDS:
        LOG.warning("最新文章产物已超过允许时效，拒绝发布旧内容: %s", latest.name)
        return None
    return latest


def materialize(run: Path) -> tuple[Path, dict]:
    title = load_json(run / "18-final-title.json").get("title", "").strip()
    html_path = run / "19-final-article.html"
    if not html_path.exists():
        html_path = run / "16-revised-article-round-1.html"
    html = html_path.read_text(encoding="utf-8")
    cover_url = load_json(run / "11-cover.json").get("imageUrl", "").strip()
    if not title or not html or not cover_url:
        raise RuntimeError("发布产物缺少标题、正文或封面")
    key = hashlib.sha256((title + html).encode("utf-8")).hexdigest()[:20]
    directory = OUTBOX / key
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "article.html").write_text(html, encoding="utf-8")
    cover_path = directory / "cover.jpg"
    if not cover_path.exists():
        urllib.request.urlretrieve(cover_url, cover_path)
    manifest_path = directory / "manifest.json"
    manifest = load_json(manifest_path) if manifest_path.exists() else {
        "id": key, "title": title, "sourceRun": run.name,
        "createdAt": datetime.now().astimezone().isoformat(), "status": "ready", "attempts": 0,
    }
    manifest.update({"title": title, "html": "article.html", "cover": "cover.jpg", "contentHash": key})
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return directory, manifest


def is_toutiao_image_url(url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    host = (parsed.hostname or "").lower()
    return bool(host) and any(
        host == suffix[1:] or host.endswith(suffix)
        for suffix in TOUTIAO_IMAGE_HOST_SUFFIXES
    )


def validate_public_image_url(url: str) -> urllib.parse.ParseResult:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise RuntimeError("正文图片地址不是有效的 HTTP/S URL")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    addresses = socket.getaddrinfo(
        parsed.hostname,
        port,
        type=socket.SOCK_STREAM,
    )
    if not addresses:
        raise RuntimeError("正文图片域名无法解析")
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if not ip.is_global:
            raise RuntimeError("正文图片地址指向非公网 IP")
    return parsed


def download_body_image(url: str) -> tuple[bytes, str]:
    validate_public_image_url(url)
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 ToutiaoPublisher/1.0"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        validate_public_image_url(response.geturl())
        content_type = response.headers.get_content_type().lower()
        suffix = {
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/webp": ".webp",
            "image/gif": ".gif",
        }.get(content_type)
        if not suffix:
            raise RuntimeError(f"正文图片类型不受支持: {content_type}")
        payload = response.read(MAX_BODY_IMAGE_BYTES + 1)
    if not payload or len(payload) > MAX_BODY_IMAGE_BYTES:
        raise RuntimeError("正文图片为空或超过 10MB")
    return payload, suffix


def rehost_body_images(
    html: str,
    client: ToutiaoProtocolClient,
) -> tuple[str, int, int]:
    """将外部正文图上传到头条 CDN；失败时仅移除对应图片。"""
    uploaded = 0
    removed = 0
    cache: dict[str, str] = {}

    def replace_image(match: re.Match[str]) -> str:
        nonlocal removed, uploaded
        tag = match.group(0)
        source_match = re.search(
            r'''\bsrc\s*=\s*["']([^"']+)["']''',
            tag,
            flags=re.IGNORECASE,
        )
        if not source_match:
            removed += 1
            return ""
        source = source_match.group(1).strip()
        if is_toutiao_image_url(source):
            return tag
        if source in cache:
            uploaded_url = cache[source]
        elif uploaded >= MAX_BODY_IMAGES:
            removed += 1
            return ""
        else:
            try:
                payload, suffix = download_body_image(source)
                with tempfile.NamedTemporaryFile(suffix=suffix) as image_file:
                    image_file.write(payload)
                    image_file.flush()
                    uploaded_image = client.upload_image(Path(image_file.name))
                uploaded_url = str(uploaded_image["url"])
                cache[source] = uploaded_url
                uploaded += 1
            except Exception as error:
                host = urllib.parse.urlparse(source).hostname or "unknown"
                LOG.warning(
                    "头条正文图片转存失败，已移除该图: host=%s, error=%s",
                    host,
                    error,
                )
                removed += 1
                return ""
        escaped_url = html_module.escape(uploaded_url, quote=True)
        start, end = source_match.span(1)
        return tag[:start] + escaped_url + tag[end:]

    transformed = re.sub(
        r"<img\b[^>]*>",
        replace_image,
        html,
        flags=re.IGNORECASE,
    )
    return transformed, uploaded, removed


def publish(directory: Path, manifest: dict) -> None:
    config = load_toml(CONFIG)
    credentials = load_active_account_credentials(config)
    manifest["status"] = "publishing"
    manifest["attempts"] = int(manifest.get("attempts", 0)) + 1
    save_manifest(directory, manifest)
    try:
        with ToutiaoProtocolClient(
            config,
            CONFIG.parent,
            cookie_override=credentials["cookies"],
            headers_override=credentials["headers"],
        ) as client:
            body_html, uploaded_images, removed_images = rehost_body_images(
                (directory / manifest["html"]).read_text(encoding="utf-8"),
                client,
            )
            LOG.info(
                "头条正文图片处理完成: 转存=%d, 移除=%d",
                uploaded_images,
                removed_images,
            )
            article = ExternalArticle(
                title=manifest["title"],
                summary=manifest["title"],
                body_html=body_html,
                tags=[],
                topic=manifest["title"],
            )
            report = client.publish(article, "publish", directory / manifest["cover"])
        manifest.update({"status": "published", "publishedAt": datetime.now().astimezone().isoformat(), "report": report})
    except Exception as error:  # 保留失败状态，下一次心跳按次数重试。
        manifest.update({"status": "failed", "error": str(error), "failedAt": datetime.now().astimezone().isoformat()})
        raise
    finally:
        save_manifest(directory, manifest)


def load_toml(path: Path) -> dict:
    import tomllib
    return tomllib.loads(path.read_text(encoding="utf-8"))


def load_active_account_credentials(config: dict) -> dict:
    """读取面板中当前激活账号的加密会话，不复制或打印 Cookie。"""
    tenants_root = STATE / "tenants"
    tenants = [
        path for path in tenants_root.iterdir()
        if path.is_dir() and (path / "accounts.json").is_file()
    ] if tenants_root.is_dir() else []
    if ACCOUNT_TENANT_ID:
        tenants = [path for path in tenants if path.name == ACCOUNT_TENANT_ID]
    if len(tenants) != 1:
        raise RuntimeError(
            "无法确定头条面板账号租户；请配置 TOUTIAO_ACCOUNT_TENANT_ID"
        )

    tenant_root = tenants[0]
    tenant_config = deepcopy(config)
    tenant_config["dashboard"] = {
        "accounts_file": str(tenant_root / "accounts.json"),
        "secret_key_file": str(tenant_root / ".secret-key"),
    }
    store = AccountStore(tenant_config, CONFIG.parent)
    credentials = store.active_credentials()
    if not credentials or not credentials.get("cookies"):
        raise RuntimeError("当前头条账号未登录或会话信息为空")
    return credentials


def save_manifest(directory: Path, manifest: dict) -> None:
    (directory / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def publication_day() -> str:
    return now_beijing().strftime("%Y-%m-%d")


def has_published_today() -> bool:
    if not DAILY_LEDGER.is_file():
        return False
    try:
        payload = load_json(DAILY_LEDGER)
    except (OSError, json.JSONDecodeError):
        LOG.warning("每日发布记录无法读取，保守地停止自动发布")
        return True
    return payload.get("lastPublishedDay") == publication_day()


def mark_published_today(manifest: dict) -> None:
    DAILY_LEDGER.write_text(
        json.dumps(
            {
                "lastPublishedDay": publication_day(),
                "articleId": manifest["id"],
                "publishedAt": datetime.now().astimezone().isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )


def due() -> bool:
    return now_beijing().strftime("%H:%M") >= SCHEDULE


def tick() -> None:
    if PUBLISH_ENABLED and due() and has_published_today():
        LOG.info("今日已成功发布过头条文章，跳过重复群发")
        return
    run = article_run()
    if not run:
        LOG.info("尚未发现可发布的主系统文章产物")
        return
    directory, manifest = materialize(run)
    if manifest.get("status") == "published" or not due() or not PUBLISH_ENABLED:
        return
    if manifest.get("status") == "failed" and int(manifest.get("attempts", 0)) >= 3:
        LOG.error("任务 %s 已失败三次，停止自动重试", manifest["id"])
        return
    publish(directory, manifest)
    mark_published_today(manifest)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    LOG.info("头条独立发布器已启动，正式发布开关=%s", PUBLISH_ENABLED)
    STATE.mkdir(parents=True, exist_ok=True)
    OUTBOX.mkdir(parents=True, exist_ok=True)
    Path(os.getenv("HOME", str(STATE / "chrome-home"))).mkdir(
        parents=True,
        exist_ok=True,
    )
    Path(os.getenv("XDG_CONFIG_HOME", str(STATE / "chrome-home/.config"))).mkdir(
        parents=True,
        exist_ok=True,
    )
    while True:
        try:
            tick()
        except (PublisherError, OSError, RuntimeError) as error:
            LOG.exception("头条独立发布任务失败: %s", error)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
