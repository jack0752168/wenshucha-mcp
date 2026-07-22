#!/usr/bin/env node
/**
 * 端到端:啟 MCP server,實際 call search_cases,確認真的呼到上游 v1 API
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.resolve(here, "..", "bin", "wenshucha-mcp.mjs");

const child = spawn("node", [bin], {
  stdio: ["pipe", "pipe", "inherit"],
  env: {
    ...process.env,
    WENSHUCHA_API_KEY: process.env.WENSHUCHA_API_KEY || "wsc_trial_demo_001",
    WENSHUCHA_API_BASE: process.env.WENSHUCHA_API_BASE || "http://localhost:3030",
  },
});

const responses = [];
let buf = "";
child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) {
      try { responses.push(JSON.parse(line)); }
      catch { console.error("Non-JSON line:", line); }
    }
  }
});

const send = (msg) => child.stdin.write(JSON.stringify(msg) + "\n");

send({
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "e2e", version: "0.0.1" },
  },
});

setTimeout(() => {
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({
    jsonrpc: "2.0", id: 2, method: "tools/call",
    params: {
      name: "search_cases",
      arguments: { q: "经济性裁员 工龄7年", province: "北京市", term_reason: "layoff" },
    },
  });
}, 200);

setTimeout(() => {
  send({
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "case_stats", arguments: { dimension: "term_reason" } },
  });
}, 1200);

// 原本固定等 3 秒就 kill —— 那是照 localhost:3030 假後端的速度定的。
// 打生產 (tob.wenshucha.com) 時 search_cases 要十幾秒到數十秒,固定 3 秒必然拿不到
// 響應而報「did not return stats」的假失敗。改成輪詢等齊兩個響應,最多等 90 秒。
const DEADLINE_MS = 90_000;
const startedAt = Date.now();
const waitForBoth = setInterval(() => {
  const got2 = responses.some((r) => r.id === 2);
  const got3 = responses.some((r) => r.id === 3);
  const timedOut = Date.now() - startedAt > DEADLINE_MS;
  if (!((got2 && got3) || timedOut)) return;
  clearInterval(waitForBoth);
  if (timedOut) console.error(`(warn: 等滿 ${DEADLINE_MS / 1000}s 才收齊,上游偏慢)`);
  finish();
}, 500);

function finish() {
  child.kill();
  const r2 = responses.find((r) => r.id === 2);
  const r3 = responses.find((r) => r.id === 3);
  const ok2 = r2?.result?.content?.[0]?.text?.includes("\"stats\"");
  const ok3 = r3?.result?.content?.[0]?.text?.includes("\"cells\"");
  if (!ok2) {
    console.error("FAIL: search_cases did not return stats");
    console.error(JSON.stringify(r2, null, 2));
    process.exit(1);
  }
  if (!ok3) {
    console.error("FAIL: case_stats did not return cells");
    console.error(JSON.stringify(r3, null, 2));
    process.exit(1);
  }
  console.log("OK: search_cases returned stats payload (length=" + r2.result.content[0].text.length + ")");
  console.log("OK: case_stats returned cells payload (length=" + r3.result.content[0].text.length + ")");
  console.log("\nSample search_cases excerpt:");
  console.log(r2.result.content[0].text.slice(0, 300));
  process.exit(0);
}
