import { assertEquals } from "@std/assert";
import { verifyBearerToken } from "./http.ts";

Deno.test("Toutiao relay rejects missing bearer token", async () => {
  const request = new Request("http://localhost/api/toutiao/session");

  const response = await verifyBearerToken(request, "secret");

  assertEquals(response?.status, 401);
});

Deno.test("Toutiao relay accepts matching bearer token", async () => {
  const request = new Request("http://localhost/api/toutiao/session", {
    headers: { Authorization: "Bearer secret" },
  });

  const response = await verifyBearerToken(request, "secret");

  assertEquals(response, null);
});
