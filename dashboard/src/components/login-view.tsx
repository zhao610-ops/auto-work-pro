import { useState } from "react";
import { Button, Card, Input } from "./ui.tsx";

export function LoginView(
  { onLogin, error }: { onLogin: (apiKey: string) => void; error?: string },
) {
  const [value, setValue] = useState("");
  return (
    <main className="grid min-h-screen place-items-center bg-[#f8fafc] px-4">
      <Card className="w-full max-w-md p-6">
        <div className="mb-6">
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#f38020]">
            TrendPublish
          </div>
          <h1 className="tp-title text-2xl font-semibold">
            TrendPublish 控制台
          </h1>
          <p className="tp-muted mt-2 text-sm leading-6">
            输入 API key 后查看运行记录、产物和配置。
          </p>
        </div>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim()) onLogin(value.trim());
          }}
        >
          <label className="space-y-2">
            <span className="tp-muted text-sm">API key</span>
            <Input
              type="password"
              autoFocus
              value={value}
              onChange={(event) => setValue(event.currentTarget.value)}
              placeholder="Bearer token"
            />
          </label>
          {error && (
            <div className="tp-danger rounded-md border p-3 text-sm">
              {error}
            </div>
          )}
          <Button className="w-full" variant="primary" type="submit">
            进入控制台
          </Button>
        </form>
      </Card>
    </main>
  );
}
