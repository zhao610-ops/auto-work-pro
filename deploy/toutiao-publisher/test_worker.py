"""头条独立发布器的安全门禁回归测试。"""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path


def load_worker_module():
    accounts = types.ModuleType("toutiao_accounts")
    accounts.AccountStore = type("AccountStore", (), {})
    protocol = types.ModuleType("toutiao_protocol")
    protocol.PublisherError = type("PublisherError", (Exception,), {})
    protocol.ToutiaoProtocolClient = type("ToutiaoProtocolClient", (), {})
    sys.modules["toutiao_accounts"] = accounts
    sys.modules["toutiao_protocol"] = protocol
    path = Path(__file__).with_name("worker.py")
    spec = importlib.util.spec_from_file_location("toutiao_worker", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("无法加载头条发布器模块")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


WORKER = load_worker_module()


class ContentSafetyGateTest(unittest.TestCase):
    def test_accepts_explicit_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            run = Path(directory)
            (run / "19-content-safety.json").write_text(
                json.dumps({"passed": True}, ensure_ascii=False),
                encoding="utf-8",
            )
            WORKER.require_content_safety_passed(run)

    def test_rejects_missing_result(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, "缺少"):
                WORKER.require_content_safety_passed(Path(directory))

    def test_rejects_blocked_result(self):
        with tempfile.TemporaryDirectory() as directory:
            run = Path(directory)
            (run / "19-content-safety.json").write_text(
                json.dumps(
                    {"passed": False, "blockedCategories": ["politics"]},
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(RuntimeError, "politics"):
                WORKER.require_content_safety_passed(run)


class ToutiaoRewriteGateTest(unittest.TestCase):
    def test_accepts_ready_safe_rewrite(self):
        with tempfile.TemporaryDirectory() as directory:
            run = Path(directory)
            payload = {
                "ready": True,
                "safetyPassed": True,
                "title": "ASML 区域收入结构释放哪些信号",
                "summary": "从公开报告拆解区域收入结构。",
                "html": "<section><p>正文内容</p></section>",
            }
            (run / "20-toutiao-article.json").write_text(
                json.dumps(payload, ensure_ascii=False),
                encoding="utf-8",
            )
            self.assertEqual(WORKER.load_toutiao_rewrite(run), payload)

    def test_rejects_missing_rewrite(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, "缺少"):
                WORKER.load_toutiao_rewrite(Path(directory))

    def test_rejects_unready_rewrite(self):
        with tempfile.TemporaryDirectory() as directory:
            run = Path(directory)
            (run / "20-toutiao-article.json").write_text(
                json.dumps(
                    {
                        "ready": False,
                        "safetyPassed": False,
                        "error": "命中政治门禁",
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(RuntimeError, "命中政治门禁"):
                WORKER.load_toutiao_rewrite(run)


class PublicationStatusTest(unittest.TestCase):
    def test_detects_public_article(self):
        payload = {
            "data": {
                "list": [{
                    "pgc_id": "1001",
                    "article_attr": {
                        "is_passed": True,
                        "show_share": True,
                        "status_desc": "已发布",
                        "article_url": "https://www.toutiao.com/article/1001/",
                    },
                }]
            }
        }
        result = WORKER.find_publication_status(payload, "1001")
        self.assertEqual(result["state"], "public")
        self.assertTrue(result["showShare"])

    def test_detects_limited_article_from_json_cell(self):
        payload = {
            "data": {
                "list": [{
                    "pgc_cell": json.dumps({
                        "pgc_id": "1002",
                        "article_attr": {
                            "is_passed": True,
                            "status_desc": "已发布",
                        },
                        "menu_list": [{
                            "show_share": False,
                            "forbid_share_reason": "该内容不支持分享",
                            "visibility_level": 15,
                        }],
                    }, ensure_ascii=False),
                }]
            }
        }
        result = WORKER.find_publication_status(payload, "1002")
        self.assertEqual(result["state"], "limited")
        self.assertEqual(result["reason"], "该内容不支持分享")
        self.assertEqual(result["visibilityLevel"], 15)

    def test_detects_rejected_article(self):
        payload = {
            "data": {
                "list": [{
                    "item_id": "1003",
                    "is_unpass": True,
                    "status_desc": "审核未通过",
                    "unpass_reason": "内容质量不足",
                }]
            }
        }
        result = WORKER.find_publication_status(payload, "1003")
        self.assertEqual(result["state"], "rejected")
        self.assertEqual(result["reason"], "内容质量不足")

    def test_keeps_unknown_article_reviewing(self):
        result = WORKER.find_publication_status({"data": {"list": []}}, "1004")
        self.assertEqual(result["state"], "reviewing")


if __name__ == "__main__":
    unittest.main()
