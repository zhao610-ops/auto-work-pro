import { assertEquals } from "@std/assert";
import {
  errorHttpStatus,
  toToutiaoRelayError,
  ToutiaoRelayError,
} from "./errors.ts";

Deno.test("Toutiao relay keeps typed error code and status", () => {
  const error = new ToutiaoRelayError("CONTENT_INVALID", "正文不能为空");

  assertEquals(toToutiaoRelayError(error), error);
  assertEquals(errorHttpStatus(error.code), 400);
});

Deno.test("Toutiao relay wraps unknown errors", () => {
  const error = toToutiaoRelayError(new Error("页面变更"));

  assertEquals(error.code, "UNKNOWN");
  assertEquals(error.message, "页面变更");
  assertEquals(errorHttpStatus("DRAFT_SAVE_FAILED"), 500);
});
