# 模板展示

TrendPublish 提供了多种可用于内容发布的模板。

## 微信文章模板

| 模板名   | 预览                                                                      | 说明                                                               |
| -------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| default  | ![default](https://oss.liuyaowen.cn/images/weixin-template-default.png)   | 微信原生正式风，适合通用 AI 资讯与日常发布                         |
| modern   | ![modern](https://oss.liuyaowen.cn/images/weixin-template-modern.png)     | 蓝青科技资讯风，适合趋势速览与产品技术动态                         |
| tech     | ![tech](https://oss.liuyaowen.cn/images/weixin-template-tech.png)         | 工程技术专栏风，适合技术解读与开发实践                             |
| mianpro  | ![mianpro](https://oss.liuyaowen.cn/images/weixin-template-mianpro.png)   | AI 日报风，适合每日精选、简报和连续栏目                            |
| longform | ![longform](https://oss.liuyaowen.cn/images/weixin-template-longform.png) | 杂志长文风，适合观察、评论与专题综述                               |
| product  | ![product](https://oss.liuyaowen.cn/images/weixin-template-product.png)   | 更新日志风，适合工具更新、版本亮点与产品公告                       |
| minimal  | ![minimal](https://oss.liuyaowen.cn/images/weixin-template-minimal.png)   | 极简阅读风，适合正式、克制、内容优先的发布                         |
| darktech | ![darktech](https://oss.liuyaowen.cn/images/weixin-template-darktech.png) | 深色研究笔记风，适合高信息密度的技术摘要                           |
| dynamic  | 本地预览生成                                                              | AI 根据本次文章内容实时生成公众号内联 HTML，失败自动回退 `minimal` |

通过 `features.article.renderer.template` 选择微信文章模板：

```ts
features: {
  article: {
    renderer: {
      template: "dynamic",
    },
  },
}
```

可选值：`default`、`modern`、`tech`、`mianpro`、`longform`、`product`、`minimal`、`darktech`、`dynamic`、`random`。

`dynamic` 不使用固定 EJS 样式，会在每次发布时调用 AI
根据文章列表生成完整的微信兼容 HTML。所有样式会被后处理为内联样式，并清理
`div`、`style`、`script`、`svg`、`class` 等不适合公众号编辑器的标签和属性。

本地预览命令：

```bash
deno task preview
```

预览文件会输出到 `src/temp/preview_weixin_*.html`。
