# 法律 AI 生成的案号和判词引用，如何用 MCP 工具核验？

> 2026-11-05：本文记录文书查正式远程 MCP 的真实调用摘录。仓库本地代码是历史客户端，以下四工具由远程服务提供。

## 接入与工具

远程端点：`https://mcp.wenshucha.com/mcp`（Streamable HTTP）；鉴权头 `x-api-key`。可用公开测试 Key `wsc_demo_public`。每 IP 每天合计 20 次工具调用，其中最多 5 篇正文，另有共享月额度；生产使用须独立 Key。

- `search_judgments`：BM25 词汇检索，使用简体中文；不是向量语义检索。
- `get_judgment`：传 `caseNo` 读取可用库内正文。未收录、无正文、不可解析或截断标记需保留。
- `verify_case_number`：传 `caseNo`，核对本库是否命中及返回的法院、日期。
- `verify_quote`：必填 `quote`（至少6字），核验某案时同时传同一 `caseNo`，不能把其他案件中的相似句当作本案引文。

## 同一文书的真实正例与明确构造的反例

样本案号 `（2016）浙0204执3826号` 为执行类通知文书，正文返回1,622字符、`body_truncated=false`。下列摘录只验证案号及文本匹配链路，不是实体裁判观点示范；历史法条表述不代表现行法律适用。不公布当事人信息或整篇正文。

### positive-case

工具：`verify_case_number`

参数：
```json
{
  "caseNo": "（2016）浙0204执3826号"
}
```

实际响应字段摘录（非完整响应）：
```json
{
  "verdict": "exists"
}
```

### positive-quote

工具：`verify_quote`

参数：
```json
{
  "caseNo": "（2016）浙0204执3826号",
  "quote": "依照《中华人民共和国民事诉讼法》第二百四十一条和《最高人民法院关于适用〈中华人民共和国民事诉讼法〉执行程序若干问题的解释》第三十一条、第三十二条、第三十三条规定，责令你(单位)在收到此令后5日内，如实向本院报告当前以及收到执行通知之日前一年的财产情况。"
}
```

实际响应字段摘录（非完整响应）：
```json
{
  "verdict": "verified",
  "match_mode": "token_phrase",
  "occurrences": 1
}
```

### synthetic-negative-case

工具：`verify_case_number`

参数：
```json
{
  "caseNo": "（2099）不存在法院民初999999999号"
}
```

实际响应字段摘录（非完整响应）：
```json
{
  "verdict": "not_found"
}
```

### synthetic-negative-quote

工具：`verify_quote`

参数：
```json
{
  "caseNo": "（2016）浙0204执3826号",
  "quote": "本段为接口核验反例并非裁判文书原文"
}
```

实际响应字段摘录（非完整响应）：
```json
{
  "verdict": "not_in_this_case"
}
```

## 返回值如何解释

| 返回 | 含义 | 处置 |
|---|---|---|
| `exists` | 本库命中案号 | 核对法院、日期和可用正文 |
| `verified` | 指定案号内分词连续短语命中 | 人工阅读上下文，不等于法律观点成立 |
| `not_found` | 本库未命中 | 标记本库未核实，不能直接认定伪造 |
| `not_in_this_case` | 引文未匹配指定案号 | 检查转述、中文分词、正文缺失并人工复核 |
| 错误、超时或额度不足 | 调用未完成 | 记为未核验，不能当作通过或查无此案 |

`verify_quote` 忽略标点和空白、受中文分词边界影响，不是逐字节鉴定。引用命中不证明法律适用、判决后续效力或检索完整性。文书查不提供中国裁判文书网原文直链，必要时凭案号、法院和日期自行复核。

## 客户端配置与正式使用

- [完整接入参数与客户端区别](https://www.wenshucha.com/mcp/quickstart/)
- [核验指南及公开实测](https://www.wenshucha.com/blog/legal-ai-hallucination-citation-verification.html#live-verification-example)
- [正式付费方案](https://www.wenshucha.com/pricing/)
- [律所与机构申请](https://www.wenshucha.com/mcp/apply/)

这是一组技术冒烟测试，不是准确率或正文覆盖率评测。未来数据、版本或额度变化可能影响复现。
