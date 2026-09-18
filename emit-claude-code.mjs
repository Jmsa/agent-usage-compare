#!/usr/bin/env node
// Claude Code -> safe usage blob (schema v1). Reads local transcripts, emits
// ONLY whitelisted aggregate fields. Raw transcript text never leaves this box.
//
// Usage:
//   node emit-claude-code.mjs --alias james --role dev --days 30 > usage/james-claude-code.json
//
// See SCHEMA.md for the contract. Nothing here writes free text - by construction.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const ALIAS = args.alias || os.userInfo().username;
const ROLE = args.role || "dev";
const DAYS = Number(args.days || 30);
const CUTOFF = Date.now() - DAYS * 86400_000;
const PROJECTS = path.join(os.homedir(), ".claude", "projects");

// --- allowlists / normalizers (keep private -> generic mapping OUT of the output) ---

// Built-in slash commands are public tool surface, safe to name. Custom commands
// (anything not in this set) can encode a client/product, so they get dropped.
const BUILTIN_COMMANDS = new Set([
  "clear", "compact", "cost", "config", "model", "effort", "mcp", "login",
  "logout", "help", "review", "init", "memory", "agents", "resume", "status",
  "vim", "doctor", "bug", "export", "ide", "permissions", "statusline",
  "add-dir", "hooks", "terminal-setup", "release-notes", "feedback",
]);

// Real MCP server name -> generic type. Extend for your stack; only the TYPE ships.
function mcpType(server) {
  const s = server.toLowerCase();
  if (/(linear|jira|github|asana|shortcut)/.test(s)) return "issue-tracker";
  if (/(chrome|playwright|puppeteer|browser)/.test(s)) return "browser";
  if (/(postgres|mysql|maria|mongo|bigquery|sqlite|db)/.test(s)) return "db";
  if (/(docs|notion|confluence|drive|obsidian)/.test(s)) return "docs";
  if (/(slack|discord|teams)/.test(s)) return "chat";
  if (/(salesforce|hubspot|stripe)/.test(s)) return "saas";
  return "other";
}

// Local-only keyword classifier. Reads private first-message text HERE and emits
// only the bucket. Approximate - good enough for aggregate comparison.
const WORK_TYPES = [
  "plan_design", "build_feature", "debug_fix", "improve_quality",
  "analyze_data", "prototype", "write_docs",
];
function classify(text) {
  const t = (text || "").toLowerCase();
  if (/\b(review|refactor|clean ?up|nitpick|lint|test coverage|merge conflict|feedback on)\b/.test(t)) return "improve_quality";
  if (/\b(bug|error|fail|502|broken|not working|investigate|why (is|does|are)|hang|crash|502|500)\b/.test(t)) return "debug_fix";
  if (/\b(prd|rfc|readme|doc|docs|write up|test notes|copy)\b/.test(t)) return "write_docs";
  if (/\b(poc|prototype|spike|try out|throwaway|experiment)\b/.test(t)) return "prototype";
  if (/\b(chart|metric|count|query|number|breakdown|how many|sanity check|status|assigned to me)\b/.test(t)) return "analyze_data";
  if (/\b(add|build|create|implement|hook up|set up|deploy|expose|finish|feature|new endpoint)\b/.test(t)) return "build_feature";
  if (/\b(plan|design|approach|strategy|what would it take|high level|understand|architecture|consider|think about)\b/.test(t)) return "plan_design";
  return "plan_design"; // conservative default - most sessions start as scoping
}

function firstUserText(lines) {
  for (const o of lines) {
    if (o.type !== "user") continue;
    const c = o.message?.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      const txt = c.find((x) => x?.type === "text");
      if (txt) return txt.text;
    }
  }
  return "";
}

function extractCommand(text) {
  const tag = /<command-name>\s*\/?([a-z0-9-]+)\s*<\/command-name>/i.exec(text || "");
  if (tag) return tag[1];
  const lead = /^\/([a-z0-9-]+)\b/i.exec((text || "").trim());
  return lead ? lead[1] : null;
}

// --- accumulators ---
const acc = {
  sessions: 0,
  tokens: { input: 0, output: 0 },
  workType: Object.fromEntries(WORK_TYPES.map((w) => [w, 0])),
  models: {},
  effort: {},
  commands: {},
  mcp: {},
};

async function readSession(file) {
  const lines = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const ln of rl) {
    if (!ln.trim()) continue;
    try { lines.push(JSON.parse(ln)); } catch { /* skip partial */ }
  }
  if (!lines.length) return;

  // window filter: keep session if any message falls inside the window
  const inWindow = lines.some((o) => o.timestamp && Date.parse(o.timestamp) >= CUTOFF);
  if (!inWindow) return;

  acc.sessions++;

  // work type from the opening prompt (classified locally, text discarded)
  const opener = firstUserText(lines);
  acc.workType[classify(opener)]++;

  // model + effort counted per-session (dominant value), not per-message, so a
  // few long sessions don't drown out everyone else.
  const sessModels = {};
  const sessEfforts = {};

  for (const o of lines) {
    if (o.type === "user") {
      const c = o.message?.content;
      const text = typeof c === "string" ? c : Array.isArray(c) ? (c.find((x) => x?.type === "text")?.text || "") : "";
      const cmd = extractCommand(text);
      if (cmd && BUILTIN_COMMANDS.has(cmd)) acc.commands[cmd] = (acc.commands[cmd] || 0) + 1;
    }
    if (o.type === "assistant") {
      const m = o.message || {};
      if (m.model && !m.model.startsWith("<")) {
        const fam = /opus/.test(m.model) ? "opus" : /sonnet/.test(m.model) ? "sonnet" : /haiku/.test(m.model) ? "haiku" : /fable/.test(m.model) ? "fable" : m.model;
        sessModels[fam] = (sessModels[fam] || 0) + 1;
      }
      if (o.effort) sessEfforts[o.effort] = (sessEfforts[o.effort] || 0) + 1;
      const u = m.usage;
      if (u) {
        // fresh prompt tokens only; cache_read is the same context re-read and
        // would inflate the total many times over.
        acc.tokens.input += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        acc.tokens.output += u.output_tokens || 0;
      }
      for (const c of m.content || []) {
        if (c?.type === "tool_use" && typeof c.name === "string" && c.name.startsWith("mcp__")) {
          const server = c.name.split("__")[1] || "unknown";
          const type = mcpType(server);
          acc.mcp[type] = (acc.mcp[type] || 0) + 1;
        }
      }
    }
  }

  // roll per-session dominant model + effort into the global tallies
  const dominant = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1])[0]?.[0];
  const dm = dominant(sessModels);
  if (dm) acc.models[dm] = (acc.models[dm] || 0) + 1;
  const de = dominant(sessEfforts);
  if (de) acc.effort[de] = (acc.effort[de] || 0) + 1;
}

function toPercents(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const out = {};
  for (const [k, v] of Object.entries(counts)) out[k] = Math.round((v / total) * 100);
  return out;
}

const files = [];
for (const dir of fs.readdirSync(PROJECTS)) {
  const full = path.join(PROJECTS, dir);
  if (!fs.statSync(full).isDirectory()) continue;
  for (const f of fs.readdirSync(full)) {
    if (f.endsWith(".jsonl")) files.push(path.join(full, f));
  }
}

for (const f of files) await readSession(f);

const blob = {
  schemaVersion: 1,
  alias: ALIAS,
  role: ROLE,
  agent: "claude-code",
  windowDays: DAYS,
  sessionCount: acc.sessions,
  tokens: {
    input: acc.tokens.input,
    output: acc.tokens.output,
    total: acc.tokens.input + acc.tokens.output,
  },
  workTypeBreakdown: toPercents(acc.workType),
  models: acc.models,
  effort: acc.effort,
  builtinCommands: acc.commands,
  mcpByType: acc.mcp,
};

process.stdout.write(JSON.stringify(blob, null, 2) + "\n");
