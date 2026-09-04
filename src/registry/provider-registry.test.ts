import { assertEquals, assertThrows } from "@std/assert";
import { ProviderAdapter, ProviderRegistry } from "./provider-registry.ts";

Deno.test("ProviderRegistry registers and returns adapters", () => {
  type Config = { enabled: boolean };
  const registry = new ProviderRegistry<Config, ProviderAdapter<Config>>();
  registry.register({
    id: "mock",
    kind: "fetch",
    isConfigured: (config) => config.enabled,
  });

  assertEquals(registry.has("mock"), true);
  assertEquals(registry.get("mock").isConfigured({ enabled: true }), true);
  assertEquals(registry.list().map((adapter) => adapter.id), ["mock"]);
});

Deno.test("ProviderRegistry rejects duplicate adapter ids", () => {
  type Config = { enabled: boolean };
  const registry = new ProviderRegistry<Config, ProviderAdapter<Config>>();
  const adapter: ProviderAdapter<Config> = {
    id: "mock",
    kind: "fetch",
    isConfigured: () => true,
  };

  registry.register(adapter);
  assertThrows(() => registry.register(adapter), Error);
});
