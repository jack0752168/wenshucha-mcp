/**
 * 文书查 / SinoVerdict MCP server
 *
 * 三個 tool:
 *   - search_cases:  類案檢索 + 量化統計（POST /api/v1/cases/search）
 *   - get_case:      取單條案件詳情（GET /api/v1/cases/{doc_id}）
 *   - case_stats:    按 dimension 切片聚合（GET /api/v1/stats?dimension=...）
 *
 * 環境變數:
 *   WENSHUCHA_API_KEY   必填,試用 key
 *   WENSHUCHA_API_BASE  選填,預設 https://tob.wenshucha.com
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const API_BASE = (process.env.WENSHUCHA_API_BASE || "https://tob.wenshucha.com").replace(/\/+$/, "");
const API_KEY = process.env.WENSHUCHA_API_KEY || "";

function ensureKey() {
  if (!API_KEY) {
    throw new Error(
      "Missing WENSHUCHA_API_KEY env. 申請試用 key 請發信至 chenjiaxin@wenshucha.com 或致電 131-6872-7779"
    );
  }
}

async function apiFetch(path, { method = "GET", body } = {}) {
  ensureKey();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json",
      "User-Agent": "wenshucha-mcp/0.1.0",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const code = json?.code || "http_error";
    throw new Error(`${code} (${res.status}): ${json?.error || text.slice(0, 200)}`);
  }
  return json;
}

const TOOLS = [
  {
    name: "search_cases",
    description:
      "檢索中國勞動爭議裁判文書(110 萬+ 結構化判例),返回 Top 20 高相似度案件 + 金額分位數(p25/中位/p75) + 勝訴率 + 關鍵裁判因素。支援案情文本 + 結構化過濾(省份/案由/解雇原因/工齡/年份)混合檢索。每條結果含中國裁判文書網原文連結。",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "案情關鍵詞,例:「經濟性裁員 工齡7年 拒簽合同」" },
        province: { type: "string", description: "省份,例:北京市/上海市/廣東省" },
        reason: {
          type: "string",
          description: "案由,例:勞動爭議/追索勞動報酬糾紛/勞動合同糾紛/確認勞動關係糾紛/經濟補償金糾紛",
        },
        term_reason: {
          type: "string",
          enum: ["layoff", "fired", "contract_end", "mutual", "quit"],
          description: "解除/終止原因:layoff=經濟性裁員 / fired=過失性辭退 / contract_end=合同到期 / mutual=協商一致 / quit=員工辭職",
        },
        years_min: { type: "number", description: "工齡下限(年)" },
        years_max: { type: "number", description: "工齡上限(年)" },
        year_from: { type: "number", description: "判決年份起" },
        year_to: { type: "number", description: "判決年份止" },
      },
    },
  },
  {
    name: "get_case",
    description:
      "依 doc_id 取單條判決詳情。doc_id 來自 search_cases 結果。",
    inputSchema: {
      type: "object",
      required: ["doc_id"],
      properties: {
        doc_id: { type: "string", description: "判決書唯一 id(16-64 位字母數字)" },
      },
    },
  },
  {
    name: "case_stats",
    description:
      "按 dimension 切片回傳勞動爭議判例聚合統計。每個 cell 含案件數、p25/中位/p75 金額、勝訴率、平均月薪。",
    inputSchema: {
      type: "object",
      properties: {
        dimension: {
          type: "string",
          enum: ["province", "term_reason", "years_bucket"],
          description: "切片維度:province=省份 / term_reason=解雇原因 / years_bucket=工齡分桶",
          default: "province",
        },
      },
    },
  },
];

function toolResult(data) {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function toolError(err) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `Error: ${err.message || String(err)}`,
      },
    ],
  };
}

async function handleTool(name, args) {
  if (name === "search_cases") {
    const data = await apiFetch("/api/v1/cases/search", { method: "POST", body: args || {} });
    return toolResult(data);
  }
  if (name === "get_case") {
    const id = args?.doc_id;
    if (!id) throw new Error("doc_id required");
    const data = await apiFetch(`/api/v1/cases/${encodeURIComponent(id)}`);
    return toolResult(data);
  }
  if (name === "case_stats") {
    const dim = args?.dimension || "province";
    const data = await apiFetch(`/api/v1/stats?dimension=${encodeURIComponent(dim)}`);
    return toolResult(data);
  }
  throw new Error(`Unknown tool: ${name}`);
}

export async function run() {
  const server = new Server(
    { name: "wenshucha-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      return await handleTool(name, args);
    } catch (err) {
      return toolError(err);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[wenshucha-mcp] ready · base=${API_BASE} · key=${API_KEY ? API_KEY.slice(0, 10) + "..." : "(none)"}`);
}
