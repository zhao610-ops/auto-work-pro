export function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TrendPublish Dashboard</title>
  <style>
    :root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: #18181b; background: #fafafa; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    section { max-width: 560px; border: 1px solid #e4e4e7; border-radius: 12px; background: white; padding: 24px; box-shadow: 0 1px 3px rgba(24,24,27,0.08); }
    h1 { margin: 0 0 10px; font-size: 20px; }
    p { margin: 0; color: #52525b; line-height: 1.7; }
    code { background: #f4f4f5; border-radius: 6px; padding: 2px 5px; }
  </style>
</head>
<body>
  <section>
    <h1>Dashboard 尚未构建</h1>
    <p>
      当前服务没有找到 <code>dist/dashboard</code> 前端资源。请先运行
      <code>deno task dev</code> 会自动构建 dashboard；也可以执行
      <code>deno run --config dashboard/deno.json -A npm:vite@8.0.13 build --config dashboard/vite.config.ts</code>
      后重新启动服务。
    </p>
  </section>
</body>
</html>`;
}
