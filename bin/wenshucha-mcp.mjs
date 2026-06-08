#!/usr/bin/env node
import { run } from "../src/server.mjs";

run().catch((err) => {
  console.error("[wenshucha-mcp] fatal:", err);
  process.exit(1);
});
