# 工作流手动触发 API

## 功能概述

此 API
提供了手动触发微信文章发布工作流的能力，可以在需要时立即执行，而不需要等待定时任务。

## 接口信息

- **接口地址**: `http://localhost:8000/api/workflow`
- **请求方式**: POST
- **数据格式**: JSON-RPC 2.0
- **Content-Type**: `application/json`
- **Authorization**: Bearer Token

## 认证方式

API 使用 Bearer Token 认证机制。需要在请求头中添加 `Authorization` 字段：

```
Authorization: Bearer your-api-key
```

其中 `your-api-key` 需要替换为实际的 API 密钥。API 密钥在
`trendpublish.config.ts` 的 `server.apiKey` 中配置。

## 快速开始

### 基本调用示例

```bash
curl -X POST http://localhost:8000/api/workflow \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "jsonrpc": "2.0",
    "method": "triggerWorkflow",
    "params": {
      "dryRun": true
    },
    "id": 1
  }'
```

### 请求参数说明

```json
{
  "jsonrpc": "2.0",
  "method": "triggerWorkflow",
  "params": {
    "dryRun": true,
    "maxArticles": 5,
    "sourceType": "all"
  },
  "id": 1
}
```

`workflowType=weixin-article-workflow`
的旧请求仍兼容，但不再支持切换到其他工作流。

### 响应示例

成功响应：

```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "message": "微信文章工作流已成功触发"
  },
  "id": 1
}
```

认证失败响应：

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32001,
    "message": "未授权的访问",
    "data": {
      "error": "缺少有效的 Authorization 请求头"
    }
  }
}
```

无效参数响应：

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32602,
    "message": "无效的参数",
    "data": {
      "error": "workflowType 仅兼容 weixin-article-workflow"
    }
  },
  "id": 1
}
```

## 错误处理

| 错误代码 | 说明         | 解决方案                              |
| -------- | ------------ | ------------------------------------- |
| -32001   | 未授权的访问 | 检查 Authorization 请求头是否正确设置 |
| -32600   | 无效的请求   | 检查请求格式是否符合JSON-RPC 2.0规范  |
| -32601   | 方法不存在   | 确认method是否为"triggerWorkflow"     |
| -32602   | 无效的参数   | 检查请求参数是否合法                  |
| -32603   | 内部错误     | 查看服务器日志了解具体错误原因        |

## 配置

在 `trendpublish.config.ts` 中添加以下配置：

```ts
server: {
  apiKey: "your-api-key",
}
```

## 更多信息

完整的JSON-RPC协议规范请参考：[JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)
