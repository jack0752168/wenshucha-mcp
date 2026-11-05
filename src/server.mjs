/**
 * 文书查 / SinoVerdict MCP server
 *
 * 七個 tool:
 *   - search_cases:          勞動爭議類案檢索 + 金額分位（POST /api/v1/cases/search）
 *   - get_case:              取單條案件詳情（GET /api/v1/cases/{doc_id}）
 *   - case_stats:            8 萬勞動爭議快照按 dimension 切片（GET /api/v1/stats?dimension=...）
 *   - search_judgments:      全案由樣本庫檢索，帶原文連結、無全文（POST /api/v1/search）
 *   - browse_full_corpus:    全量庫按省/案由瀏覽，有全文、source_url 恆 null（GET /api/v1/judgements）
 *   - search_judgments_full: 全量庫關鍵詞檢索，有全文、source_url 恆 null（GET /api/v1/fulltext）
 *   - case_analytics:        全庫實時聚合 1.51 億（GET /api/analytics）
 *
 * ⚠️ tool description 是 AI 助手唯一的判斷依據，**每一句口徑都必須是實測過的**。
 *    2026-07-22 內容級探活第 54 發修正了五處與線上實測不符的描述（詳見各 tool 說明內的實測日期與樣本數）：
 *    fulltext 謊稱帶原文連結、analytics 體量少報 3 倍且年份範圍寫窄、search_cases 謊稱給勝訴率、
 *    case_stats 把抽樣條數說成案件數、get_case 的 doc_id 格式寫錯。改任何一句前請先 curl 坐實。
 *
 * ⚠️ 2026-08-15 第 219 發（biz-engine 逐端點實測，**推翻下方 ①的一半，並找出它藏起來的那一半**）：
 *    上游已對**結構化過濾欄位**加了繁簡正規化，但**全文關鍵詞 `q` 沒有**，而本檔此前把兩者寫成同一句話。
 *    ①**已正規化、警告作廢的**（繁簡兩種寫法今日實測 total 逐位相同、首筆逐字相同）：
 *      `/api/v1/search` 的 reason（勞動爭議→劳动争议）與 province（廣東省→广东省，回顯就是簡體）；
 *      `/api/v1/judgements` 的 province（廣東 8,721,483＝广东）、cause（民間借貸糾紛 9,374,165＝简体）；
 *      `/api/analytics` 的 cause（民間借貸糾紛 9,322,422/57 桶、勞動爭議 1,932,525/38 桶，皆與簡體同）；
 *      `/api/v1/cases/search` 的 province / reason（2026-08-13 實測，filters_effective 顯示已正規化）。
 *    ②**沒正規化、且失敗態比舊描述更貴的**：`/api/v1/fulltext` 的 **`q`**（走字面全文比對）。
 *      實測 `q=劳动争议` total 10000（封頂）vs `q=勞動爭議` total **894**，且那 894 的首筆是
 *      「陈利旭、王議锋其他案由首次执行执行通知书」——只是標題裡剛好有個「議」字，**不是勞動爭議案**。
 *      注意它**不是穩定回 0**：`q=離婚糾紛` 回 10000（語料裡確有繁體書寫的文書）⇒ 失敗態是
 *      **看起來成功、召回少一到兩個數量級的雜訊集**，比舊描述說的「回 0」隱蔽得多。**q 請一律送簡體。**
 *    ⇒ 教訓同 BL-085/BL-095/08-02 province 全稱那條：**響亮的失敗態被寫進文件，貴的那種零字。**
 *    ③（同日順帶）本站自 2026-08-11 由 Node standalone 自收請求後，URL 裡**未編碼的中文回 400 且響應體為空**，
 *      且該層**在鑑權之前**。本 MCP 走 URLSearchParams 自動編碼故不受影響；但直接 curl 的客戶會踩到
 *      （/tob/api-trial 三個 GET 範例已於同日修正）。**別把空體 400 讀成「站掛了」。**
 *
 * ⚠️ 2026-07-30 第 131 發：上游切 ES 後本檔描述整整八天沒跟上，逐條 curl 坐實後修六處（運行時零改動）：
 *    ①~~**所有過濾值必須簡體**——繁體（廣東 / 勞動爭議 / 民間借貸糾紛）在 judgements / fulltext /
 *      cases.search / search 四個端點一律回 **HTTP 200 + 0 條、無任何報錯**~~
 *      **↑ 2026-08-15 實測作廢，見上方第 219 發：結構化欄位已正規化，只剩 fulltext 的 `q` 仍需簡體。**
 *      （保留原文供追溯：當時本檔每一個示例值都是繁體 → 助手照抄示例空手而歸。示例值已全部改簡體。）
 *    ②browse_full_corpus 的 source_url 實測 **0/50 全 null**，原描述卻自稱「唯一全文+連結雙全」，
 *      還叫「必須可回鏈核驗」的客戶優先走它 = 精確指向唯一零連結的 tool；③它的 total 已是真實命中數
 *      （浙江 751 萬），非舊版「候選池封頂 50」；④它的 doc_id 回查 get_case 實測 **200 + 全文**，非「必定 404」；
 *      ⑤它的 pageSize 上限是 50 不是 100（傳 100 靜默按 50 處理）；⑥case_analytics 的 cause 是**精確全稱**
 *      不是前綴（民间借贷=0 / 民间借贷纠纷=57 省）。
 *    當前全局事實：**全文與原文連結拿不到同一份結果裡**——有連結的只有 search_judgments（無全文），
 *    兩個帶全文的全量工具 source_url 都恆 null。別再寫任何「某工具雙全」的話。
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
      "历史本地 Beta 客户端工具，不代表当前远程文书查 MCP。当前远程服务与四个工具见 https://www.wenshucha.com/mcp/ 。不要把本工具的旧数据范围、工具名或返回字段当作现行服务说明。劳动争议历史样本检索及赔偿金额分位；仅含获赔样本，不能据此计算胜诉率。统计可能封顶，举证要点为固定编辑清单，不是本次查询的统计结论。",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "案情關鍵詞,**必須簡體**,例:「经济性裁员 工龄7年 拒签合同」" },
        province: { type: "string", description: "省份全稱,例:北京市/上海市/广东省。**繁簡皆可**——2026-08-13/08-15 實測 廣東省 已被上游正規化為 广东省 並正常回筆數(filters_effective 顯示的就是簡體);建議仍送簡體以與回顯一致" },
        reason: {
          type: "string",
          description: "案由,**必須簡體**,例:劳动争议/追索劳动报酬纠纷/劳动合同纠纷/确认劳动关系纠纷/经济补偿金纠纷",
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
      "历史本地 Beta 客户端工具，不代表当前远程文书查 MCP。当前远程服务与四个工具见 https://www.wenshucha.com/mcp/ 。不要把本工具的旧数据范围、工具名或返回字段当作现行服务说明。读取历史样本的单条详情。不同历史检索来源的ID未必兼容；字段和正文是否存在以真实返回为准。",
    inputSchema: {
      type: "object",
      required: ["doc_id"],
      properties: {
        doc_id: {
          type: "string",
          description:
            "原樣回傳檢索結果裡的 doc_id。兩種合法格式:32 位十六進制,或 `<dataset>:<id>`(含冒號,如 2025:5afdb157… / ws_new:846c05f2-…)。格式非法回 400 bad_doc_id。",
        },
      },
    },
  },
  {
    name: "case_stats",
    description:
      "历史本地 Beta 客户端工具，不代表当前远程文书查 MCP。当前远程服务与四个工具见 https://www.wenshucha.com/mcp/ 。不要把本工具的旧数据范围、工具名或返回字段当作现行服务说明。聚合历史劳动争议样本。不是当前1.6亿记录全库统计，样本仅含获赔案件；不得报告为总体胜诉率。",
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
      "历史本地 Beta 客户端工具，不代表当前远程文书查 MCP。当前远程服务与四个工具见 https://www.wenshucha.com/mcp/ 。不要把本工具的旧数据范围、工具名或返回字段当作现行服务说明。历史关键词与结构化条件检索。输入简体中文法律词及完整案由，旧工具可能仅匹配标题。不要承诺全量检索、正文或法院原文直链；以实际返回为准。",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "標題/當事人關鍵詞,空格分詞,**必須簡體**,如「工商银行 信用卡」" },
        reason: { type: "string", description: "案由,**必須為精確全稱**,如 民间借贷纠纷/买卖合同纠纷/劳动争议/机动车交通事故责任纠纷。**繁體已正規化**(2026-08-15 實測);**缺「纠纷」二字仍實測回 0 條且不報錯**,拿不準先用 case_analytics(dim=cause)取詞表原樣照抄" },
        province: { type: "string", description: "省份全稱,**必須簡體**,如 广东省/北京市" },
        court: { type: "string", description: "法院名稱片段,**必須簡體**" },
        year_from: { type: "number", description: "判決年份起" },
        year_to: { type: "number", description: "判決年份止" },
        limit: { type: "number", description: "返回條數,默認 20,最多 50" },
      },
    },
  },
  {
    name: "browse_full_corpus",
    description:
      "历史本地 Beta 客户端工具，不代表当前远程文书查 MCP。当前远程服务与四个工具见 https://www.wenshucha.com/mcp/ 。不要把本工具的旧数据范围、工具名或返回字段当作现行服务说明。历史浏览接口，按省份和可选案由返回候选记录。候选计数不等于全库计数，不保证每条有正文；source_url可能为空，不得拼接或承诺法院原文链接。请按案号、法院、日期独立核对。",
    inputSchema: {
      type: "object",
      properties: {
        province: { type: "string", description: "省份左前綴,如 广东/北京/上海(建議必傳,查詢快)。**繁簡皆可**(2026-08-15 實測 廣東=广东、遼寧=辽宁 total 逐位相同);⚠️真正的坑是**別送規範全稱**(广东省 比 广东 少約 20%)、市名回 0" },
        cause: { type: "string", description: "案由左前綴,**必須簡體**,如 机动车交通事故/劳动/民间借贷(可選;當前較慢)" },
        page: { type: "number", description: "頁碼,默認 1" },
        pageSize: { type: "number", description: "每頁條數,默認 20,**上限 50**(傳更大值靜默按 50 處理)" },
      },
    },
  },
  {
    name: "search_judgments_full",
    description:
      "历史本地 Beta 客户端工具，不代表当前远程文书查 MCP。当前远程服务与四个工具见 https://www.wenshucha.com/mcp/ 。不要把本工具的旧数据范围、工具名或返回字段当作现行服务说明。历史全文接口，可能存在无正文和参数口径限制，不保证正文覆盖，也不提供可保证的法院原文链接。缺少结果不证明案件不存在。",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "標題關鍵詞,**必須簡體**,如 工商银行/房屋买卖/张某" },
        province: { type: "string", description: "省份,如 广东/北京。**繁簡皆可**(2026-08-15 實測已正規化);⚠️需要送簡體的是本工具的 `q`,不是本欄" },
        cause: { type: "string", description: "案由左前綴,**必須簡體**,如 民间借贷/劳动" },
        court: { type: "string", description: "法院名稱片段,**必須簡體**" },
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
      "历史本地 Beta 客户端工具，不代表当前远程文书查 MCP。当前远程服务与四个工具见 https://www.wenshucha.com/mcp/ 。不要把本工具的旧数据范围、工具名或返回字段当作现行服务说明。历史聚合接口；不得把过去的桶计数当成今天的数据规模或全国案件量。案由使用完整名称，注意脏桶、缺失字段和样本口径。",
    inputSchema: {
      type: "object",
      properties: {
        dim: { type: "string", enum: ["cause", "province", "year", "court"], description: "統計維度", default: "cause" },
        province: { type: "string", description: "省份過濾(可選),**簡體全稱**如 广东省/浙江省" },
        cause: { type: "string", description: "案由過濾(可選),**簡體精確全稱、不是前綴**——2026-07-30 實測「民间借贷」回 0 桶、「民间借贷纠纷」回 57 省;請先用 dim=cause 取詞表再原樣照抄" },
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
