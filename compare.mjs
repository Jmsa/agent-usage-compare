#!/usr/bin/env node
// Merge N safe usage blobs -> collective view + per-person table.
// Agent-agnostic: works on any blob that follows SCHEMA.md, regardless of which
// agent produced it.
//
// Usage:
//   node compare.mjs usage/*.json
//   node compare.mjs usage/*.json --html            # also write usage-report.html
//   node compare.mjs usage/*.json --html=report.html

import fs from "node:fs";

// pull --html[=path] out of the args; everything else is a blob path
let htmlPath = null;
const files = [];
for (const arg of process.argv.slice(2)) {
  if (arg === "--html") htmlPath = "usage-report.html";
  else if (arg.startsWith("--html=")) htmlPath = arg.slice("--html=".length);
  else files.push(arg);
}
if (!files.length) {
  console.error("usage: node compare.mjs <blob.json> [more.json ...] [--html[=path]]");
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

// --- optional HTML dashboard (same aggregates, nothing new leaks) ---
if (htmlPath) {
  fs.writeFileSync(htmlPath, renderHtml());
  console.log(`Wrote ${htmlPath}\n`);
}

function renderHtml() {
  // one categorical color per person; cycles past 8
  const PALETTE = [
    "#5468e0", "#d98a34", "#2fa39b", "#d1517a",
    "#6fae3f", "#9a63d4", "#d0483f", "#3d8fd1",
  ];
  const people = blobs.map((b, i) => ({
    alias: b.alias || `person ${i + 1}`,
    role: b.role || "",
    agent: b.agent || "-",
    color: PALETTE[i % PALETTE.length],
    sessions: b.sessionCount || 0,
    total: b.tokens?.total || 0,
    input: b.tokens?.input || 0,
    output: b.tokens?.output || 0,
    topWork: LABEL[topKey(b.workTypeBreakdown)] || "-",
    topModel: topKey(b.models),
    topEffort: topKey(b.effort),
    topMcp: topKey(b.mcpByType),
    mcp: b.mcpByType || {},
  }));

  const collectiveRows = WORK_TYPES
    .map((k) => ({ label: LABEL[k], pct: Math.round(collective[k]) }))
    .filter((r) => r.pct > 0);

  const workRows = WORK_TYPES
    .map((k) => ({ label: LABEL[k], values: blobs.map((b) => b.workTypeBreakdown?.[k] || 0) }))
    .filter((r) => r.values.some((v) => v > 0));

  // shared scale so MCP bars are comparable across people
  const mcpMax = Math.max(1, ...people.flatMap((p) => Object.values(p.mcp)));

  const agents = [...new Set(people.map((p) => p.agent))];
  const windows = [...new Set(blobs.map((b) => b.windowDays).filter(Boolean))];
  const data = {
    people, collectiveRows, workRows, mcpMax,
    meta: {
      count: people.length,
      sessions: totalSessions,
      tokens: fmt(totalTokens),
      agent: agents.length === 1 ? agents[0] : `${agents.length} agents`,
      window: windows.length === 1 ? `${windows[0]}-day window` : "mixed windows",
    },
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Usage Compare</title>
<style>
  :root {
    --ground:#eef0f4; --surface:#fff; --surface-2:#f6f7fa; --border:#d9dde5;
    --ink:#191c23; --muted:#5f6775; --faint:#949bab;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ground:#0f1115; --surface:#171a21; --surface-2:#1d212a; --border:#2a2f3a;
      --ink:#e7eaf0; --muted:#9aa3b2; --faint:#6b7383;
    }
  }
  :root[data-theme="dark"] {
    --ground:#0f1115; --surface:#171a21; --surface-2:#1d212a; --border:#2a2f3a;
    --ink:#e7eaf0; --muted:#9aa3b2; --faint:#6b7383;
  }
  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--ground); color:var(--ink); line-height:1.5;
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .mono { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
  .num { font-variant-numeric:tabular-nums; }
  .wrap { max-width:960px; margin:0 auto; padding:40px 24px 64px; }
  header { margin-bottom:28px; }
  .eyebrow { font:500 12px/1 ui-monospace,monospace; letter-spacing:.14em; text-transform:uppercase; color:var(--faint); margin:0 0 10px; }
  h1 { font-size:clamp(28px,5vw,40px); font-weight:700; letter-spacing:-.02em; margin:0 0 6px; text-wrap:balance; }
  .sub { color:var(--muted); margin:0; font-size:15px; }
  .strip { display:grid; grid-template-columns:repeat(4,1fr); gap:1px; background:var(--border);
    border:1px solid var(--border); border-radius:12px; overflow:hidden; margin:26px 0 40px; }
  .stat { background:var(--surface); padding:18px 20px; }
  .stat .k { font:500 11px/1 ui-monospace,monospace; letter-spacing:.1em; text-transform:uppercase; color:var(--faint); margin:0 0 6px; }
  .stat .v { font-size:26px; font-weight:700; letter-spacing:-.01em; }
  .stat .v small { font-size:14px; font-weight:500; color:var(--muted); }
  section { margin-bottom:40px; }
  h2 { font-size:13px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:var(--muted);
    margin:0 0 16px; padding-bottom:10px; border-bottom:1px solid var(--border); }
  .legend { display:flex; gap:18px; flex-wrap:wrap; margin:0 0 20px; }
  .legend span { display:inline-flex; align-items:center; gap:8px; font-size:13px; color:var(--muted); }
  .dot { width:11px; height:11px; border-radius:3px; display:inline-block; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:16px; }
  .card { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:20px; position:relative; overflow:hidden; }
  .card .stripe { position:absolute; left:0; top:0; bottom:0; width:4px; }
  .card h3 { margin:0 0 2px; font-size:18px; font-weight:700; }
  .card .role { font:400 12px/1 ui-monospace,monospace; text-transform:uppercase; letter-spacing:.08em; color:var(--faint); }
  .rows { margin-top:16px; display:grid; gap:10px; }
  .r { display:flex; justify-content:space-between; align-items:baseline; font-size:14px; }
  .r .rk { color:var(--muted); } .r .rv { font-weight:600; }
  .bars { display:grid; gap:16px; }
  .bar-item .name { font-size:13px; font-weight:500; margin-bottom:6px; }
  .track { display:grid; gap:4px; }
  .barline { display:flex; align-items:center; gap:8px; }
  .bar { height:15px; border-radius:4px; min-width:2px; }
  .barline .pct { font:400 11px/1 ui-monospace,monospace; color:var(--muted); }
  .tok { display:grid; gap:18px; }
  .th { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:8px; }
  .th .who { font-weight:600; font-size:15px; } .th .tot { font:400 13px/1 ui-monospace,monospace; color:var(--muted); }
  .split { display:flex; height:22px; border-radius:5px; overflow:hidden; background:var(--surface-2); }
  .split .seg { height:100%; display:flex; align-items:center; padding:0 8px; font:400 11px/1 ui-monospace,monospace; white-space:nowrap; }
  .tok-key { display:flex; gap:16px; flex-wrap:wrap; margin-top:14px; font-size:12px; color:var(--muted); }
  .tok-key span { display:inline-flex; align-items:center; gap:6px; }
  .swatch { width:20px; height:10px; border-radius:2px; }
  .mline { margin-bottom:12px; } .mline:last-child { margin-bottom:0; }
  .ml { display:flex; justify-content:space-between; font-size:13px; margin-bottom:5px; }
  .ml .mv { font-family:ui-monospace,monospace; color:var(--muted); }
  .mtrack { height:8px; border-radius:4px; background:var(--surface-2); overflow:hidden; }
  .mfill { height:100%; border-radius:4px; }
  footer { margin-top:44px; padding-top:18px; border-top:1px solid var(--border); color:var(--faint);
    font:400 12px/1.5 ui-monospace,monospace; }
  @media (max-width:680px){ .strip{ grid-template-columns:repeat(2,1fr); } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <p class="eyebrow" id="eyebrow"></p>
    <h1>How we use Claude</h1>
    <p class="sub">Aggregates only &mdash; no transcripts left any machine.</p>
  </header>
  <div class="strip" id="strip"></div>
  <section><h2>Per person</h2><div class="cards" id="cards"></div></section>
  <section><h2>Collective work type</h2><div class="bars" id="collective"></div></section>
  <section><h2>Work type by person</h2><div class="legend" id="legend"></div><div class="bars" id="work"></div></section>
  <section><h2>Token volume &mdash; input vs output</h2><div class="tok" id="tok"></div><div class="tok-key" id="tokkey"></div></section>
  <section><h2>MCP usage by type</h2><div class="cards" id="mcp"></div></section>
  <footer>schemaVersion 1 &middot; agent-usage-compare &middot; counts &amp; buckets only, safe by construction</footer>
</div>
<script id="data" type="application/json">${JSON.stringify(data)}</script>
<script>
  const D = JSON.parse(document.getElementById("data").textContent);
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;" }[c]));
  const soft = (c) => \`color-mix(in srgb, \${c} 26%, transparent)\`;
  const fmt = (n) => n >= 1e6 ? (n/1e6).toFixed(1)+"M" : n >= 1e3 ? Math.round(n/1e3)+"k" : String(n);

  document.getElementById("eyebrow").textContent = D.meta.agent + " \\u00b7 " + D.meta.window;

  document.getElementById("strip").innerHTML = [
    ["People", D.meta.count], ["Sessions", D.meta.sessions],
    ["Tokens", D.meta.tokens], ["Agent", D.meta.agent],
  ].map(([k,v]) => \`<div class="stat"><p class="k">\${esc(k)}</p><div class="v num">\${esc(v)}</div></div>\`).join("");

  document.getElementById("cards").innerHTML = D.people.map((p) => \`
    <div class="card">
      <span class="stripe" style="background:\${p.color}"></span>
      <h3>\${esc(p.alias)}</h3><span class="role">\${esc([p.role, p.agent].filter(Boolean).join(" \\u00b7 "))}</span>
      <div class="rows">
        <div class="r"><span class="rk">Sessions</span><span class="rv num">\${p.sessions}</span></div>
        <div class="r"><span class="rk">Tokens</span><span class="rv num">\${fmt(p.total)}</span></div>
        <div class="r"><span class="rk">Top work</span><span class="rv">\${esc(p.topWork)}</span></div>
        <div class="r"><span class="rk">Top model</span><span class="rv">\${esc(p.topModel)}</span></div>
        <div class="r"><span class="rk">Top effort</span><span class="rv">\${esc(p.topEffort)}</span></div>
        <div class="r"><span class="rk">Top MCP</span><span class="rv">\${esc(p.topMcp)}</span></div>
      </div>
    </div>\`).join("");

  const cMax = Math.max(1, ...D.collectiveRows.map((r) => r.pct));
  document.getElementById("collective").innerHTML = D.collectiveRows.map((r) => \`
    <div class="bar-item"><div class="name">\${esc(r.label)}</div>
      <div class="barline"><div class="bar" style="width:\${(r.pct/cMax*100).toFixed(1)}%;background:var(--muted)"></div><span class="pct">\${r.pct}%</span></div>
    </div>\`).join("");

  document.getElementById("legend").innerHTML = D.people.map((p) =>
    \`<span><span class="dot" style="background:\${p.color}"></span>\${esc(p.alias)}</span>\`).join("");

  const wMax = Math.max(1, ...D.workRows.flatMap((r) => r.values));
  document.getElementById("work").innerHTML = D.workRows.map((r) => \`
    <div class="bar-item"><div class="name">\${esc(r.label)}</div><div class="track">
      \${r.values.map((v,i) => \`<div class="barline"><div class="bar" style="width:\${(v/wMax*100).toFixed(1)}%;background:\${D.people[i].color}"></div><span class="pct">\${v}%</span></div>\`).join("")}
    </div></div>\`).join("");

  document.getElementById("tok").innerHTML = D.people.map((p) => {
    const inPct = p.total ? (p.input/p.total*100) : 0, outPct = p.total ? (p.output/p.total*100) : 0;
    return \`<div><div class="th"><span class="who">\${esc(p.alias)}</span><span class="tot">\${fmt(p.total)} total</span></div>
      <div class="split">
        <div class="seg" style="width:\${inPct.toFixed(1)}%;background:\${p.color};color:#fff">\${fmt(p.input)} in</div>
        <div class="seg" style="width:\${outPct.toFixed(1)}%;background:\${soft(p.color)};color:var(--ink)">\${fmt(p.output)} out</div>
      </div></div>\`;
  }).join("");
  document.getElementById("tokkey").innerHTML =
    \`<span><span class="swatch" style="background:var(--muted)"></span>solid = input</span>\` +
    \`<span><span class="swatch" style="background:var(--surface-2)"></span>faded = output</span>\`;

  document.getElementById("mcp").innerHTML = D.people.map((p) => {
    const entries = Object.entries(p.mcp).sort((a,b) => b[1]-a[1]);
    const lines = entries.length ? entries.map(([k,v]) => \`
      <div class="mline"><div class="ml"><span>\${esc(k)}</span><span class="mv num">\${v.toLocaleString()}</span></div>
        <div class="mtrack"><div class="mfill" style="width:\${(v/D.mcpMax*100).toFixed(1)}%;background:\${p.color}"></div></div></div>\`).join("")
      : \`<div class="ml"><span style="color:var(--faint)">none</span></div>\`;
    return \`<div class="card"><span class="stripe" style="background:\${p.color}"></span>
      <h3 style="font-size:15px">\${esc(p.alias)}</h3><div style="margin-top:14px">\${lines}</div></div>\`;
  }).join("");
</script>
</body>
</html>
`;
}
