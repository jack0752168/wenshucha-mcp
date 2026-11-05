# 文书查 / SinoVerdict：裁判文书 MCP

> 更新：2026-11-05。本仓库的本地代码是历史 Beta 客户端，不是当前远程生产服务；请使用下方现行端点与官方接入文档。旧版劳动争议样本规模、工具名和申请方式不能用来描述现行服务。

## 当前远程服务

文书查 MCP 面向法律 AI 开发者、律所与企业法务，将约 **1.6 亿条中国裁判文书记录**接入支持 MCP 的 Claude、Cursor 等客户端。记录数不是独立案件数，也不代表全国全部裁判文书。

- 远程端点：`https://mcp.wenshucha.com/mcp`（Streamable HTTP）
- [产品与数据局限](https://www.wenshucha.com/mcp/)
- [Claude Desktop、Cursor、Claude Code 配置与参数文档](https://www.wenshucha.com/mcp/quickstart/)
- [现行价格和额度](https://www.wenshucha.com/pricing/)
- [律所与机构接入申请](https://www.wenshucha.com/mcp/apply/)

当前服务已提供全案由词汇检索与库内正文读取，并非仅能浏览劳动争议样本。检索使用 BM25，不是向量语义检索。

## 四个现行工具

| 工具 | 用途与边界 |
| --- | --- |
| `search_judgments` | 按关键词及文档支持的条件检索裁判文书记录。 |
| `get_judgment` | 按案号取得库内判决正文；未公开、缺失或未收录的正文不能保证返回。 |
| `verify_case_number` | 检查案号在本库的命中情况；未命中不等于案件不存在或案号伪造。 |
| `verify_quote` | 将引用与库内判词比对以辅助溯源；不能代替法律适用判断或人工审阅。 |

**不提供中国裁判文书网原文直链，也不保证每条记录都有正文。** 可凭案号、法院和日期自行核对；正文非空与真正含判决内容也不能混为一谈，覆盖口径见产品页。

## 不用注册即可测试

公开测试 Key：`wsc_demo_public`，鉴权头 `x-api-key`。每 IP 每天共 20 次工具调用，其中最多 5 篇全文；另有全站共享月额度。公开 Key 不适合生产，调用前以官网实时额度说明为准。

Cursor 的 MCP 配置：

```json
{
  "mcpServers": {
    "wenshucha": {
      "url": "https://mcp.wenshucha.com/mcp",
      "headers": {"x-api-key": "wsc_demo_public"}
    }
  }
}
```

Claude Desktop 的本机配置需要转接格式，不能直接套用上面的 Cursor JSON。请按[接入指南](https://www.wenshucha.com/mcp/quickstart/)选择对应客户端。

开发者 Pro 为 ¥99/月或 ¥990/年，每月 50,000 次调用和 5,000 篇全文；团队版 ¥4,800/年；企业授权按接入范围面议。以官网现行方案为准。

## 历史代码说明

本仓库 `src/`、`bin/` 和 npm 元数据保留历史版本，用于旧客户端兼容参考。其 `browse_full_corpus`、`search_cases`、`get_case`、`case_stats` 等旧工具不属于上述现行远程服务的工具清单；不要 clone 旧代码来判断现行服务可用范围。本次仅更正文档，不更改旧客户端行为、不发布新的 npm 版本。

## 联系

文书查 · 深圳星谱网络科技有限公司  
商务电话：131-6872-7779  
邮箱：chenjiaxin@wenshucha.com  
官网：https://www.wenshucha.com
