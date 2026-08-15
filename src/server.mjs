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
      "檢索中國勞動爭議裁判文書(110 萬+ 結構化判例),返回高相似度案件 + 金額分位數(p25/中位/p75) + 通用舉證要點清單。支援案情文本 + 結構化過濾(省份/案由/解雇原因/工齡/年份)混合檢索。每條結果含中國裁判文書網原文連結(2026-07-22 實測 3/3 非空),含 body_excerpt 摘要但**不含判決全文**(要全文用 search_judgments_full 或 browse_full_corpus)。口徑注意:①`stats.win_rate` **當前恆為 null**(樣本僅含判付案,均衡樣本後才開放),不要對用戶宣稱本工具給勝訴率;②`stats.n_cases` 封頂 2000(命中過多時恆為 2000 並置 `n_cases_is_capped: true`),應讀作「2000+」而非真實命中數;③`factors` 是勞動爭議通用舉證要點的**固定清單**(每條帶 `basis:\"editorial\"`),**不隨查詢變化、命中 0 條也照返、跨案由不變**(2026-07-24 實測四組差異極大的查詢返回逐字節相同),`weight` 是人工編輯的重要性排序先驗**不是實測頻率或勝訴相關性** —— 呈現時必須說明它是通用核對清單,**嚴禁說成「本次檢索算出的關鍵裁判因素」或引用其權重作量化結論**;本次檢索的真實統計只有 `stats`(金額分位)。",
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
      "依 doc_id 取單條判決詳情。**三種來源的 doc_id 都可回查**(2026-07-30 實測):①search_cases / search_judgments 返回的 32 位十六進制;②search_judgments_full(fulltext)返回的 `<dataset>:<id>` 形式(如 `2025:5afdb157…`);③browse_full_corpus 返回的 doc_id ——切 ES 後它已是 `<dataset>:<id>` 形式(如 `2025:58de9ca0…`)而非舊版裸 hex,實測回查返 **200 + 完整 body_text**,舊描述「必定 404」已作廢。⚠️ 響應形狀**按 id 來源分三種**:樣本庫(labor_cases)那條只有 `body_excerpt`(約 150 字摘錄,**不是全文,不可照單引用為正文**)、corpus 那條不含任何正文欄位、全量庫那條才有 `body_text` 全文;不必靠鍵在不在反推,直接讀 `_meta.full_text` 布爾位,並看 `_meta.field_note`(案由鍵在樣本庫叫 `reason`、全量庫叫 `cause`)。",
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
      "按 dimension 切片回傳勞動爭議判例聚合統計。**讀的是倉庫內預計算快照**(8 萬條勞動爭議樣本,`data_mode: snapshot`),不隨全量庫更新而變,與其餘工具不是同一口徑,別把兩邊數字放一起比。每個 cell 含 n_cases、p25/中位/p75 金額、平均月薪。口徑注意:①`n_cases` 是**抽樣條數不是案件量**,province 維度每省封頂 4500(實測 9 省並列觸頂、置 `n_cases_capped: true`),**不可用於跨省比體量**——要真實案件量請用 case_analytics(全庫實時聚合);②`p25/median/p75` 是真實統計、不受封頂影響,可橫向比;③`win_rate` **恆為 null**;④province 維度已剔除入庫殘留桶(如「20廣東省」),`_meta.excluded_note` 逐一披露剔了什麼。",
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
      "全案由通用檢索:在 120 萬+ 中國裁判文書(覆蓋 1200+ 案由,如民間借貸/買賣合同/信用卡/機動車交通事故/勞動爭議/刑事等)中按關鍵詞 + 結構化條件檢索,返回標題/法院/案由/日期/案號 + 中國裁判文書網原文連結(2026-07-22 實測 20/20 非空)。**不返回判決全文**(body_text 0/20),要全文用 search_judgments_full 或 browse_full_corpus。`q` 只匹配標題不匹配全文;寬泛的 q(單字詞)冷緩存下可能耗時數十秒,建議配合 reason / province 收窄。⚠️**reason 要精確全稱**;**繁簡已不再是問題**——2026-08-15 實測 reason=勞動爭議/民間借貸糾紛 與簡體回**逐字相同**的首筆、filters 回顯已正規化為簡體,province=廣東省 同理(舊描述「繁體回 200 + 0 條」**已作廢**)。仍會靜默回 0 的是**缺「纠纷」二字**(民间借贷 → 0),空結果先懷疑寫法別直接斷言「庫裡沒有」;上面括號裡的案由是**覆蓋範圍舉例、不是可直接照抄的參數值**。與 search_cases 區別:search_cases 僅勞動爭議且帶金額分位量化,本工具是全案由通用檢索。",
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
      "全量裁判文書瀏覽(真全量,非樣本):直連完整裁判文書庫,按省份(+案由)左前綴瀏覽最新判決,返回標題/案號/案由/法院/省份/審判程序/裁判日期 + **判決全文 body_text**。⚠️**繁簡皆可**——2026-08-15 實測 province=廣東 與 广东 回**同一個 total 8,721,483**、cause=民間借貸糾紛 與簡體回**同一個 total 9,374,165**,上游已正規化(舊描述「繁體回 HTTP 200 + 0 條」**已作廢**)。真正會靜默回 0 的是**寫法**不是字體:province 是原值左前綴(送「广东」別送「广东省」,全稱少 13.63%–45.81%)、市名(深圳)回 0;cause 是分詞/子串(送詞幹「民间借贷」,送全稱會被「纠纷」淹沒成近乎不過濾)。別把空結果讀成「庫裡沒有」。口徑注意:①⚠️**本工具的 `source_url` 當前恆為 null**(2026-07-30 實測浙江 50/50 全空,body_text 則 50/50 非空)——**不要對用戶宣稱本工具帶原文連結**;當前**全文與原文連結拿不到同一份結果裡**:要連結走 search_judgments(有連結、無全文),要全文走本工具或 search_judgments_full,要回鏈核驗請用 `case_no + court + judgement_date` 三欄位回中國裁判文書網自核,**切勿拼接偽造連結**;②`total` 是該條件下的**真實命中數**(2026-07-30 實測浙江 751 萬),舊版「候選池封頂 50」口徑已作廢;③`instrument_type / judge / plaintiff / defendant / law_firms / court_opinion / referee_result` 七個結構化欄位當前 **100% 為空**(上游這批只入了正文未拆解要素,2026-07-30 浙江 50 條複測仍全空),要這些要素請自行從 body_text 讀,響應的 `_meta.empty_fields` 會按每頁實測動態上報;④本工具的 doc_id(形如 `2025:58de9ca0…`)**餵 get_case 已可回查**,2026-07-30 實測返 200 + 完整 body_text,舊版「必定 404」口徑已作廢;⑤`pageSize` 上限 **50**,傳更大值會被靜默按 50 處理(不報錯);⑥按省份瀏覽快,只加案由篩選當前較慢、可能超時,建議帶上 province。",
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
      "全量類案檢索(真全量):按關鍵詞(標題)+ 省份 + 案由 + 法院 + 年份範圍跨集合檢索,返回標題/案號/案由/法院/省份/審判程序/裁判日期 + **判決全文 body_text**。比 browse_full_corpus 多了關鍵詞/法院/年份過濾。⚠️**本工具的 `source_url` 當前恆為 null**(2026-07-30 複測广东×民间借贷 20/20 全空、body_text 則 20/20 非空;原文連結尚未隨 ES 側入庫,我們不拼接偽造鏈接)——**不要對用戶宣稱本工具結果帶原文連結**;需要可回鏈核驗時,**別改用 browse_full_corpus**——2026-07-30 實測它的 source_url 同樣 50/50 全空(舊描述稱其「全文+連結雙全」是錯的),當前**全文與原文連結拿不到同一份結果裡**:帶連結的只有 search_judgments(但它無全文),要核驗請用 `case_no + court + judgement_date` 三欄位回中國裁判文書網自行核對,**切勿拼接偽造連結**。另:body_text 約 15% 為空,可看 `has_full_text` / `body_text_len` 判斷;`q` 只匹配標題,純關鍵詞查詢較慢,建議配合省份或案由縮小範圍;⚠️**本工具的繁簡口徑分兩半,別當成同一句話**(2026-08-15 實測):**結構化欄位(province/cause)已正規化**,繁體 民間借貸 與簡體回逐字相同的首筆;**但關鍵詞 `q` 沒有正規化,走字面比對** —— `q=劳动争议` total 10000(封頂) vs `q=勞動爭議` total **894**,且那 894 的首筆是「陈利旭、王議锋其他案由首次执行执行通知书」(只是標題裡有個「議」字,**不是勞動爭議案**);而 `q=離婚糾紛` 又回 10000(語料裡確有繁體書寫的文書)⇒ **失敗態不是回 0,是看起來成功、召回少一到兩個數量級的雜訊集**。**`q` 一律送簡體**,拿到明顯偏少的 total 時先懷疑字體。",
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
      "案件大數據統計(對標法寶「案件大數據」):**全庫實時聚合**,2026-07-22 實測 year 維度 60 個桶合計 **1.51 億條**、主體覆蓋 1985–2025(非早期文檔寫的「4580萬 / 2020-2023」,該口徑已作廢)。dim=cause(案由分布)/province(地域分布)/year(年份趨勢)/court(法院排行),可疊加 province / cause / 年份過濾。返回 [{key,count}]。⚠️**cause 必須精確全稱,不做前綴匹配**(2026-07-30 實測 cause=民间借贷 回 0 桶、民间借贷纠纷 回 57 省);**繁體已正規化**——2026-08-15 實測 cause=民間借貸糾紛 回 total 9,322,422/57 桶、勞動爭議 回 1,932,525/38 桶,與簡體逐位相同(舊描述「繁體同樣 0」**已作廢**),寫錯只得 `ok:true` + 空 items 沒有報錯 → 請先無過濾跑一次 dim=cause 拿詞表再原樣照抄。這是**唯一能給真實全庫計數的工具**——case_stats 的 n_cases 是 8 萬快照裡的抽樣條數,比體量必須用本工具。口徑注意:year 維度含極少量入庫髒桶(如「1014」「209」「2027」,15 個桶合計 1,257 條 = 0.0008%),回答年份趨勢時忽略即可,別當真實年份引用。",
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
