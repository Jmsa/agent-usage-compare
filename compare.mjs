#!/usr/bin/env node
// Merge N safe usage blobs -> collective view + per-person table.
// Agent-agnostic: works on any blob that follows SCHEMA.md, regardless of which
// agent produced it.
//
// Usage:
//   node compare.mjs usage/*.json

import fs from "node:fs";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node compare.mjs <blob.json> [more.json ...]");
  process.exit(1);
}

const blobs = files.map((f) => {
  const b = JSON.parse(fs.readFileSync(f, "utf8"));
  if (b.schemaVersion !== 1) console.error(`warn: ${f} schemaVersion=${b.schemaVersion} (expected 1)`);
  return b;
});

const WORK_TYPES = [
  "plan_design", "build_feature", "debug_fix", "improve_quality",
  "analyze_data", "prototype", "write_docs",
];
const LABEL = {
  plan_design: "Plan Design", build_feature: "Build Feature", debug_fix: "Debug Fix",
  improve_quality: "Improve Quality", analyze_data: "Analyze Data",
  prototype: "Prototype", write_docs: "Write Docs",
};

function bar(pct, max) {
  const width = 20;
  const filled = max ? Math.round((pct / max) * width) : 0;
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "k";
  return String(n);
}

// --- collective work type: weight each person's percentages by their session count ---
const totalSessions = blobs.reduce((a, b) => a + (b.sessionCount || 0), 0) || 1;
const collective = Object.fromEntries(WORK_TYPES.map((w) => [w, 0]));
for (const b of blobs) {
  const w = b.sessionCount / totalSessions;
  for (const k of WORK_TYPES) collective[k] += (b.workTypeBreakdown?.[k] || 0) * w;
}
const collectiveMax = Math.max(...Object.values(collective));

console.log(`\n## How We Use Claude (${blobs.length} people)\n`);
console.log(`Collective - Work Type Breakdown:`);
for (const k of WORK_TYPES) {
  const pct = Math.round(collective[k]);
  if (pct === 0) continue;
  console.log(`  ${LABEL[k].padEnd(16)} ${bar(pct, collectiveMax)}  ${pct}%`);
}

// --- per-person table ---
function topKey(obj) {
  if (!obj || !Object.keys(obj).length) return "-";
  return Object.entries(obj).sort((a, b) => b[1] - a[1])[0][0];
}

console.log(`\nPer Person:`);
const rows = blobs.map((b) => ({
  who: `${b.alias} (${b.role})`,
  agent: b.agent,
  sessions: b.sessionCount || 0,
  tokens: fmt(b.tokens?.total || 0),
  work: LABEL[topKey(b.workTypeBreakdown)] || "-",
  model: topKey(b.models),
  effort: topKey(b.effort),
  mcp: topKey(b.mcpByType),
}));

const cols = [
  ["who", "who"], ["agent", "agent"], ["sessions", "sessions"],
  ["tokens", "tokens"], ["work", "top work"], ["model", "top model"],
  ["effort", "top effort"], ["mcp", "top mcp"],
];
const widths = cols.map(([k, h]) => Math.max(h.length, ...rows.map((r) => String(r[k]).length)));
const line = (vals) => "  " + vals.map((v, i) => String(v).padEnd(widths[i])).join("  ");
console.log(line(cols.map(([, h]) => h)));
console.log(line(widths.map((w) => "-".repeat(w))));
for (const r of rows) console.log(line(cols.map(([k]) => r[k])));

// --- collective totals ---
const totalTokens = blobs.reduce((a, b) => a + (b.tokens?.total || 0), 0);
console.log(`\nTotals: ${totalSessions} sessions, ${fmt(totalTokens)} tokens across ${blobs.length} people\n`);
