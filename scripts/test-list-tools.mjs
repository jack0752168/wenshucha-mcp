#!/usr/bin/env node
/**
 * 快速確認 MCP server 啟得起來、tools/list 回得對
 *
 * 不需要 API key —— 只走 list_tools,不會碰上游 HTTP。
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.resolve(here, "..", "bin", "wenshucha-mcp.mjs");

const child = spawn("node", [bin], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, WENSHUCHA_API_KEY: "wsc_trial_dummy_for_test_xxx" },
});

let buf = "";
const responses = [];
child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) {
      try {
        responses.push(JSON.parse(line));
      } catch (e) {
        console.error("Non-JSON line:", line);
      }
    }
  }
});

const send = (msg) => {
  child.stdin.write(JSON.stringify(msg) + "\n");
};

// 1) initialize
send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "0.0.1" },
  },
});

setTimeout(() => {
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
}, 200);

setTimeout(() => {
  child.kill();
  const initResp = responses.find((r) => r.id === 1);
  const listResp = responses.find((r) => r.id === 2);
  if (!initResp) {
    console.error("FAIL: no initialize response");
    process.exit(1);
  }
  if (!listResp || !Array.isArray(listResp.result?.tools)) {
    console.error("FAIL: no tools/list response or malformed");
    console.error(JSON.stringify(responses, null, 2));
    process.exit(1);
  }
  const names = listResp.result.tools.map((t) => t.name).sort();
  // 加 tool 時必須同步改這裡。2026-07-22 前這份清單還停在最初的 3 個,
  // 而 server 早已有 7 個 —— 唯一的冒煙測試紅了三個 commit 沒人發現。
  const expected = [
    "browse_full_corpus",
    "case_analytics",
    "case_stats",
    "get_case",
    "search_cases",
    "search_judgments",
    "search_judgments_full",
  ];
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    console.error("FAIL: tool names mismatch:", names);
    console.error("      expected:", expected);
    process.exit(1);
  }
  // description 是 AI 助手選工具的唯一依據,空描述等於這個 tool 不存在。
  const noDesc = listResp.result.tools.filter((t) => !t.description || t.description.length < 20);
  if (noDesc.length) {
    console.error("FAIL: tools missing/too-short description:", noDesc.map((t) => t.name));
    process.exit(1);
  }
  console.log(`OK: MCP server starts and lists ${names.length} tools:`, names.join(", "));
  process.exit(0);
}, 1500);
