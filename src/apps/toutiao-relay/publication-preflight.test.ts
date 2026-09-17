import { assertEquals, assertThrows } from "@std/assert";
import { ToutiaoRelayError } from "./errors.ts";
import {
  assertScheduleContentLength,
  assertScheduleCoverProvided,
} from "./publication-preflight.ts";

Deno.test("今日头条定时发布在写入草稿前必须携带原创封面", () => {
  const error = assertThrows(
    () => assertScheduleCoverProvided({ title: "测试", contentText: "正文" }),
    ToutiaoRelayError,
  );
  assertEquals(error.code, "COVER_NOT_FOUND");

  assertScheduleCoverProvided({
    title: "测试",
    contentText: "正文",
    coverImagePath: "./cover.png",
  });
});

Deno.test("今日头条定时发布拒绝过短正文", () => {
  const error = assertThrows(
    () => assertScheduleContentLength({ title: "测试", contentText: "过短" }),
    ToutiaoRelayError,
  );
  assertEquals(error.code, "CONTENT_INVALID");
  assertScheduleContentLength({
    title: "测试",
    contentText: "有效正文".repeat(80),
  });
});
