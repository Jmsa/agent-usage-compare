#!/usr/bin/env node
// TEMPLATE emitter for agents other than Claude Code (Codex, Cursor, ...).
// Copy this to emit-<agent>.mjs, fill in the "READ YOUR LOGS HERE" section to
// parse your agent's native transcript format, then emit the SAME schema so
// compare.mjs can merge it with everyone else's.
//
// The rule is identical for every agent: read private logs locally, emit ONLY
// the whitelisted aggregate fields below. No free text. See SCHEMA.md.
//
// Usage:
//   node emit-codex.mjs --alias alex --role dev --days 30 > usage/alex-codex.json

import os from "node:os";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);
const ALIAS = args.alias || os.userInfo().username;
const ROLE = args.role || "dev";
const DAYS = Number(args.days || 30);
const AGENT = args.agent || "codex"; // set to your agent id

// Same buckets everyone uses - do not rename, or the comparison breaks.
const WORK_TYPES = [
  "plan_design", "build_feature", "debug_fix", "improve_quality",
  "analyze_data", "prototype", "write_docs",
];

// ============================================================================
// READ YOUR LOGS HERE
// ----------------------------------------------------------------------------
// Parse your agent's transcripts within the last DAYS. For each session:
//   - classify the opening prompt LOCALLY into one WORK_TYPES bucket (keyword
//     heuristic or a local model call); keep only the bucket, discard the text
//   - tally model family, reasoning effort, built-in commands, MCP calls
//   - sum input/output tokens
// Map real MCP/tool names -> generic types (issue-tracker, browser, db, docs,
// chat, saas, other) and drop custom command names that could name a client.
//
// Fill these in:
const sessionCount = 0;
const tokens = { input: 0, output: 0 };
const workTypeCounts = Object.fromEntries(WORK_TYPES.map((w) => [w, 0]));
const models = {};          // e.g. { "gpt-5": 120, "o3": 40 }
const effort = {};          // e.g. { "low": 30, "high": 90 }
const builtinCommands = {}; // built-in command names only
const mcpByType = {};       // generic types only
// ============================================================================

function toPercents(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const out = {};
  for (const [k, v] of Object.entries(counts)) out[k] = Math.round((v / total) * 100);
  return out;
}

const blob = {
  schemaVersion: 1,
  alias: ALIAS,
  role: ROLE,
  agent: AGENT,
  windowDays: DAYS,
  sessionCount,
  tokens: { input: tokens.input, output: tokens.output, total: tokens.input + tokens.output },
  workTypeBreakdown: toPercents(workTypeCounts),
  models,
  effort,
  builtinCommands,
  mcpByType,
};

process.stdout.write(JSON.stringify(blob, null, 2) + "\n");
