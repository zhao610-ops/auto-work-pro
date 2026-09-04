export type ProviderKind =
  | "fetch"
  | "llm"
  | "image"
  | "publish"
  | "notify"
  | "vector";

export interface ProviderAdapter<TConfig, TProviderId extends string = string> {
  id: TProviderId;
  kind: ProviderKind;
  isConfigured(config: TConfig): boolean;
}

export interface ProviderCreateContext<TConfig, TOptions = unknown> {
  config?: TConfig;
  options?: TOptions;
}

export class ProviderRegistry<
  TConfig,
  TAdapter extends ProviderAdapter<TConfig>,
> {
  private readonly adapters = new Map<TAdapter["id"], TAdapter>();

  register(adapter: TAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Provider adapter already registered: ${adapter.id}`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  get(id: TAdapter["id"]): TAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new Error(`Unknown provider adapter: ${id}`);
    }
    return adapter;
  }

  has(id: string): boolean {
    return this.adapters.has(id as TAdapter["id"]);
  }

  list(): TAdapter[] {
    return [...this.adapters.values()];
  }
}
