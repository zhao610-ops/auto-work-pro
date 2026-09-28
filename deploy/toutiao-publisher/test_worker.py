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


if __name__ == "__main__":
    unittest.main()
