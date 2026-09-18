import { assertEquals, assertThrows } from "@std/assert";
import { ToutiaoRelayError } from "./errors.ts";
import {
  assertPublishContentLength,
  assertPublishCoverProvided,
} from "./publication-preflight.ts";

Deno.test("今日头条直接发布在写入草稿前必须携带原创封面", () => {
  const error = assertThrows(
    () => assertPublishCoverProvided({ title: "测试", contentText: "正文" }),
    ToutiaoRelayError,
  );
  assertEquals(error.code, "COVER_NOT_FOUND");

  assertPublishCoverProvided({
    title: "测试",
    contentText: "正文",
    coverImagePath: "./cover.png",
  });
});

Deno.test("今日头条直接发布拒绝过短正文", () => {
  const error = assertThrows(
    () => assertPublishContentLength({ title: "测试", contentText: "过短" }),
    ToutiaoRelayError,
  );
  assertEquals(error.code, "CONTENT_INVALID");
  assertPublishContentLength({
    title: "测试",
    contentText: "有效正文".repeat(80),
  });
});
