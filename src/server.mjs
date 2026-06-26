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
      "按 dimension 切片回傳勞動爭議判例聚合統計。每個 cell 含案件數、p25/中位/p75 金額、平均月薪(勝訴率試用版暫略)。",
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
  {
    name: "search_judgments",
    description:
      "全案由通用檢索:在 120 萬+ 中國裁判文書(覆蓋 1200+ 案由,如民間借貸/買賣合同/信用卡/機動車交通事故/勞動爭議/刑事等)中按關鍵詞 + 結構化條件檢索,返回標題/法院/案由/日期/案號 + 中國裁判文書網原文連結。與 search_cases 區別:search_cases 僅勞動爭議且帶量化(金額/勝率),search_judgments 是全案由通用檢索。",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "標題/當事人關鍵詞,空格分詞,如「工商銀行 信用卡」" },
        reason: { type: "string", description: "案由,如 民間借貸糾紛/買賣合同糾紛/勞動爭議/機動車交通事故責任糾紛" },
        province: { type: "string", description: "省份,如 廣東省/北京市" },
        court: { type: "string", description: "法院名稱片段" },
        year_from: { type: "number", description: "判決年份起" },
        year_to: { type: "number", description: "判決年份止" },
        limit: { type: "number", description: "返回條數,默認 20,最多 50" },
      },
    },
  },
  {
    name: "browse_full_corpus",
    description:
      "全量裁判文書瀏覽(1.3億+ 真全量,非樣本):直連完整裁判文書庫,按省份(+案由)左前綴瀏覽最新判決,返回標題/案號/案由/法院/省份/審判程序/裁判日期 + 中國裁判文書網原文連結。與 search_judgments / search_cases(120萬樣本 + 關鍵詞/量化檢索)的區別:本工具打的是 1.3億全量庫。注意:按省份瀏覽快;加案由篩選當前較慢、可能超時(全文檢索與聚合統計正在開放中)。",
    inputSchema: {
      type: "object",
      properties: {
        province: { type: "string", description: "省份左前綴,如 廣東/北京/上海(建議必傳,查詢快)" },
        cause: { type: "string", description: "案由左前綴,如 機動車交通事故/勞動/民間借貸(可選;當前較慢)" },
        page: { type: "number", description: "頁碼,默認 1" },
        pageSize: { type: "number", description: "每頁條數,默認 20,最多 100" },
      },
    },
  },
  {
    name: "search_judgments_full",
    description:
      "全量類案檢索(1.3億+ 真全量):按關鍵詞(標題)+ 省份 + 案由 + 法院 + 年份範圍跨集合檢索,返回標題/案號/案由/法院/省份/審判程序/裁判日期 + 判決全文 + 原文連結。比 browse_full_corpus 多了關鍵詞/法院/年份過濾且返回判決全文。建議配合省份或案由縮小範圍(純關鍵詞較慢)。",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "標題關鍵詞,如 工商銀行/房屋買賣/張某" },
        province: { type: "string", description: "省份,如 廣東/北京" },
        cause: { type: "string", description: "案由左前綴,如 民間借貸/勞動" },
        court: { type: "string", description: "法院名稱片段" },
        yearFrom: { type: "number", description: "判決年份起,如 2021" },
        yearTo: { type: "number", description: "判決年份止,如 2023" },
        page: { type: "number" },
        pageSize: { type: "number", description: "默認 20,最多 50" },
      },
    },
  },
  {
    name: "case_analytics",
    description:
      "案件大數據統計(對標法寶「案件大數據」):基於 4580萬+ 標準化裁判文書(2020-2023)的分布。dim=cause(案由分布)/province(地域分布)/year(年份趨勢)/court(法院排行),可疊加 province / cause / 年份過濾。返回 [{key,count}]。",
    inputSchema: {
      type: "object",
      properties: {
        dim: { type: "string", enum: ["cause", "province", "year", "court"], description: "統計維度", default: "cause" },
        province: { type: "string", description: "省份過濾(可選)" },
        cause: { type: "string", description: "案由過濾(可選,前綴)" },
        yearFrom: { type: "number" },
        yearTo: { type: "number" },
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
  if (name === "search_judgments") {
    const data = await apiFetch("/api/v1/search", { method: "POST", body: args || {} });
    return toolResult(data);
  }
  if (name === "browse_full_corpus") {
    const a = args || {};
    if (!a.province && !a.cause) throw new Error("province 或 cause 至少傳一個(左前綴匹配)");
    const qs = new URLSearchParams();
    if (a.province) qs.set("province", String(a.province));
    if (a.cause) qs.set("cause", String(a.cause));
    if (a.page) qs.set("page", String(a.page));
    if (a.pageSize) qs.set("pageSize", String(a.pageSize));
    const data = await apiFetch(`/api/v1/judgements?${qs.toString()}`);
    return toolResult(data);
  }
  if (name === "search_judgments_full") {
    const a = args || {};
    if (!a.q && !a.province && !a.cause && !a.court) throw new Error("至少傳 q/province/cause/court 之一");
    const qs = new URLSearchParams();
    ["q", "province", "cause", "court", "yearFrom", "yearTo", "page", "pageSize"].forEach((k) => {
      if (a[k] !== undefined && a[k] !== "") qs.set(k, String(a[k]));
    });
    const data = await apiFetch(`/api/v1/fulltext?${qs.toString()}`);
    return toolResult(data);
  }
  if (name === "case_analytics") {
    const a = args || {};
    const qs = new URLSearchParams();
    qs.set("dim", String(a.dim || "cause"));
    ["province", "cause", "yearFrom", "yearTo"].forEach((k) => {
      if (a[k] !== undefined && a[k] !== "") qs.set(k, String(a[k]));
    });
    const data = await apiFetch(`/api/analytics?${qs.toString()}`);
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
