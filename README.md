# 文书查 / SinoVerdict MCP Server

把 **110 万+ 结构化的中国劳动争议判决**接进你的 AI 助手 / Agent —— Codex、Claude Desktop、Cursor、Claude Code,或任何支持 MCP 的客户端。

> Beta 阶段限劳动争议数据集;正式版开放 1.5 亿份全量裁判文书 + 法规库。
> 申请试用 key:邮件 [chenjiaxin@wenshucha.com](mailto:chenjiaxin@wenshucha.com) 或电话 131-6872-7779,一个工作日内回复。

---

## 提供的 Tool

**两套能力**:① 全案由通用检索(120万+ 判决,覆盖 1200+ 案由);② 劳动争议专项(8万结构化判决 + 金额量化)。

| Tool | 用途 |
| --- | --- |
| `browse_full_corpus` | **全量库浏览(1.3亿+ 真全量,非样本)** —— 直连完整裁判文书库,按省份(+案由)左前缀浏览最新判决,返回标题/案号/案由/法院/省份/审判程序/裁判日期 + 原文链接。按省份浏览快;加案由筛选当前较慢(全文检索/聚合统计开放中) |
| `search_judgments` | **全案由关键词检索(120万样本)** —— 按关键词 + 案由/省份/法院/年份过滤,返回标题/法院/案由/日期/案号 + 原文链接 |
| `search_cases` | **劳动争议专项(8万样本)** —— 案情文本 + 结构化过滤(省份/案由/解雇原因/工龄/年份)→ Top 20 类案 + 金额分位(p25/中位/p75)+ 关键裁判因素 |
| `get_case` | 依 doc_id 取单条判决详情 |
| `case_stats` | 劳动争议按省份 / 解雇原因 / 工龄分桶切片聚合(金额分位 + 平均月薪)|

> **全量 vs 样本**:`browse_full_corpus` 打的是 **1.3 亿+ 完整库**(浏览式);`search_judgments`/`search_cases` 是带关键词/量化检索的样本集。全量库的全文检索与大数据聚合统计正在开放中。

> 数据规模:试用为全案由样本 120万+ 与劳动 8万;正式版开放全量 1.4 亿 + 全文检索。

每条判决均含中国裁判文书网原文链接(`source_url`),结果**可溯源、可呈堂**。

---

## 安装(三步)

```bash
# 1. 拉代码
git clone https://github.com/jack0752168/wenshucha-mcp.git ~/wenshucha-mcp

# 2. 装依赖(只需一次)
cd ~/wenshucha-mcp && npm install

# 3. 先用 curl 验证 key 通(把 <KEY> 换成你的试用 key)
curl -H "X-API-Key: <KEY>" "https://tob.wenshucha.com/api/v1/health"
# 返回 {"ok":true,...} 即 key 有效
```

---

## 接入 Codex(OpenAI Codex CLI)

### 方式一:命令行一行加(推荐)

```bash
codex mcp add wenshucha \
  --env WENSHUCHA_API_KEY=<你的试用KEY> \
  --env WENSHUCHA_API_BASE=https://tob.wenshucha.com \
  -- node $HOME/wenshucha-mcp/bin/wenshucha-mcp.mjs
```

加完确认:

```bash
codex mcp list          # 应能看到 wenshucha
codex mcp get wenshucha
```

### 方式二:手动写 `~/.codex/config.toml`

```toml
[mcp_servers.wenshucha]
command = "node"
args = ["/Users/<你>/wenshucha-mcp/bin/wenshucha-mcp.mjs"]

[mcp_servers.wenshucha.env]
WENSHUCHA_API_KEY = "<你的试用KEY>"
WENSHUCHA_API_BASE = "https://tob.wenshucha.com"
```

### 在 Codex 里怎么用

启动 `codex`,直接用自然语言让它调,例如:

> 用 wenshucha 检索「经济性裁员 工龄7年 拒签合同」在广东省的类案,给我金额区间和胜诉率。

Codex 会自动调用 `search_cases`,拿回 Top 20 类案 + 量化统计 + 裁判文书网原文链接。

---

## 接入 Claude Desktop

编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "wenshucha": {
      "command": "node",
      "args": ["/Users/<你>/wenshucha-mcp/bin/wenshucha-mcp.mjs"],
      "env": {
        "WENSHUCHA_API_KEY": "<你的试用KEY>",
        "WENSHUCHA_API_BASE": "https://tob.wenshucha.com"
      }
    }
  }
}
```

重启 Claude Desktop 后,模型侧自动看到 `search_cases` / `get_case` / `case_stats` 三个 tool。

## 接入 Cursor

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "wenshucha": {
      "command": "node",
      "args": ["/Users/<你>/wenshucha-mcp/bin/wenshucha-mcp.mjs"],
      "env": {
        "WENSHUCHA_API_KEY": "<你的试用KEY>",
        "WENSHUCHA_API_BASE": "https://tob.wenshucha.com"
      }
    }
  }
}
```

## 接入 Claude Code

```bash
claude mcp add wenshucha \
  --env WENSHUCHA_API_KEY=<你的试用KEY> \
  --env WENSHUCHA_API_BASE=https://tob.wenshucha.com \
  -- node /Users/<你>/wenshucha-mcp/bin/wenshucha-mcp.mjs
```

---

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `WENSHUCHA_API_KEY` | (无) | **必填**,试用 key |
| `WENSHUCHA_API_BASE` | `https://tob.wenshucha.com` | 选填,换 staging 时用 |

## 试用限制

- 60 次/分钟 per key
- Beta 阶段限「劳动争议」数据集
- Trial key 90 天有效,正式合作后换长期 key

## 联络

文书查 · 深圳星谱网络科技有限公司
商务电话:131-6872-7779
邮箱:chenjiaxin@wenshucha.com
官网:https://www.wenshucha.com
