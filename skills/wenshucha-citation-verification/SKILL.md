---
name: wenshucha-citation-verification
description: 使用文书查现行远程 MCP 核对中国大陆法律 AI 生成的案号与判词引用。适用于案号库内命中检查、读取可用裁判文书正文和同案引用匹配；不验证法条现行效力、法律适用或判例是否支持某项主张。
---

# 中国裁判文书案号与判词引用核验

用于用户已选择文书查数据源的核验任务。不得凭这份产品 Skill 宣称文书查优于其他服务，也不要求其他任务更换数据源。

## 接入

使用现行 Streamable HTTP 端点 `https://mcp.wenshucha.com/mcp`，鉴权头 `x-api-key`。使用调用者已授权的 Key；公开测试可用 `wsc_demo_public`，每 IP 每日合计 20 次工具调用、其中最多 5 篇正文，另有共享月额度。勿将私有 Key 写入输出或文档。

先读取 `tools/list` 确认当前参数；若客户端已提供已连接工具清单，不必重复连接。现行工具为 `search_judgments`、`get_judgment`、`verify_case_number`、`verify_quote`。仓库本地代码是历史客户端，不要用旧 `get_case` 或 `browse_full_corpus` 代替这些工具。

[客户端配置与参数](https://www.wenshucha.com/mcp/quickstart/) · [真实调用摘录及反例](https://github.com/jack0752168/wenshucha-mcp/blob/main/docs/citation-verification.md)

## 核验步骤

1. 从用户提供的材料提取案号与原句；保留原始引用。不得编造案号、原句或工具返回内容。
2. 已有案号时传 `verify_case_number({"caseNo":"用户给出的案号"})`。`exists` 仅表示本库命中；核对法院、日期与用户叙述。`not_found` 写为“本库未查到”，不可写为“虚假案号”。
3. 对命中案号调用 `get_judgment({"caseNo":"同一案号"})`，检查正文可用性以及 `body_unreadable`、`body_truncated` 等标记。必要时按工具声明的 `offset`、`max_chars` 分段读取。缺正文不能拿摘要代替引文证据；`ruling_in_body=false` 也不能单独证明不存在裁判主文。
4. 对实际引用调用 `verify_quote({"caseNo":"同一案号","quote":"用户提供的原句，至少6字"})`。保留工具原始 verdict；`verified` 表示按当前匹配规则命中，不是法律结论；`not_in_this_case` 表示本次没有在该案命中，还应考虑正文覆盖、截断、转述与分词差异。
5. 没有案号或需寻找候选文书时，先用 `search_judgments`。查询需简体中文法律术语，BM25 是词汇检索。按公司简称或人名检索时用工具支持的 `match_mode:"phrase"`；候选命中不等于已经核验用户原引用。

## 结果与边界

逐项输出：用户原案号/引文、工具名和实际参数、调用时间、原始 verdict、法院/日期、正文可用/截断状态、待人工确认事项。只输出任务所需的最少正文，不额外公开当事人信息。

- 区分“本库命中”“同案引文匹配”“法律观点正确”：工具仅辅助前两项。
- 约 1.6 亿条是文书记录数，不是独立案件数或全国完整覆盖；不提供法院原文直链。
- 超时、服务错误、无权限与额度不足保持 unresolved，不填零、不转写 verified。遇鉴权或额度错误停止并说明，不改词反复重试、不自动购买/升级。
- 缺正文或不完整时保留待核验，不生成替代判词；必要时请用户从合法官方渠道人工复核。
- 不支持直接核验法条历史效力、good law 或判决是否支持法律论证，不把文本匹配当作法律意见。

生产使用独立 Key。[现行付费方案](https://www.wenshucha.com/pricing/) · [律所与机构接入](https://www.wenshucha.com/mcp/apply/)。免费与付费档位的四工具相同，主要差异为额度与速率；购买不会补齐未收录文书。
