# Agent Usage Compare - Safe Interchange Schema

A privacy-safe format for comparing how people use coding agents (Claude Code,
Codex, Cursor, etc.) across different companies without leaking any IP.

## The one rule

**Classify locally, share only aggregates.** Raw transcripts are the *input* to
your emitter and never leave your machine. The emitter writes *only* the
whitelisted fields below. Anything not on the whitelist is dropped by
construction - there is no free-text field to accidentally fill.

If you can point at any value in the output and say what client, repo, or
feature it reveals, it does not belong in this schema.

## Agent-agnostic by design

Each agent has its own transcript format, so each agent needs its own emitter
(`emit-claude-code.mjs`, `emit-codex.mjs`, ...). Every emitter reads its native
logs and writes this same schema. The `compare` step does not care which agent
produced a blob - it merges them all and tags each row by `agent`.

## Schema (v1)

```jsonc
{
  "schemaVersion": 1,
  "alias": "james",              // pseudonym, not real name, for cross-company sharing
  "role": "dev",                 // "dev" | "qa" | "lead" | "other"
  "agent": "claude-code",        // "claude-code" | "codex" | "cursor" | ...
  "agentVersion": "1.x",         // optional, public tool version
  "windowDays": 30,

  "sessionCount": 312,

  "tokens": {                    // totals only, never per-session
    "input": 38400000,
    "output": 2800000,
    "total": 41200000
  },

  "workTypeBreakdown": {         // percentages, must sum ~100. Buckets are generic.
    "plan_design": 35,
    "build_feature": 27,
    "debug_fix": 18,
    "improve_quality": 17,
    "write_docs": 2,
    "analyze_data": 1,
    "prototype": 0
  },

  "models": {                    // model family -> session or message count. Names are public.
    "opus": 210,
    "sonnet": 88,
    "haiku": 14
  },

  "effort": {                    // reasoning-effort distribution, normalized buckets
    "low": 40,
    "medium": 180,
    "high": 80,
    "max": 12
  },

  "builtinCommands": {           // BUILT-IN slash commands only. Custom names can leak - drop them.
    "clear": 14,
    "model": 4,
    "effort": 4
  },

  "mcpByType": {                 // normalized generic TYPES, never instance/server names.
    "issue-tracker": 812,
    "browser": 634,
    "docs": 5
  }
}
```

## Field rules

| field | safe because | watch out |
|---|---|---|
| `alias` | you choose it | do not use a company-derived handle |
| `role` | generic axis | fine |
| `agent` / `agentVersion` | public tool names | fine |
| `sessionCount` | a count | fine |
| `tokens` | totals only | never emit per-session token arrays |
| `workTypeBreakdown` | generic categories | the classifier reads private text locally and emits only the bucket - text never crosses |
| `models` | model names are public | fine |
| `effort` | generic buckets | fine |
| `builtinCommands` | built-in names are public | custom command names may encode a client/product - allowlist built-ins only |
| `mcpByType` | normalized types | never emit raw server names (`linear`, `acme-prod-db`); map to `issue-tracker`, `db`, etc |

## Never emit

- Session titles, first messages, any free text
- PR numbers, ticket IDs, branch names, repo names, file paths
- Raw MCP server names or custom command/skill names
- Real name (use `alias`) if you want deniable sharing
- Per-session anything - only aggregates cross the boundary

## Work type enum

`plan_design`, `build_feature`, `debug_fix`, `improve_quality`, `analyze_data`,
`prototype`, `write_docs`. Same buckets every agent uses, so the comparison is
apples to apples.

## MCP type normalization

Map your real servers to generic types before emitting:

| real server (example) | emit as |
|---|---|
| linear, jira, github-issues | `issue-tracker` |
| claude-in-chrome, playwright | `browser` |
| postgres, mariadb, bigquery | `db` |
| claude-docs, notion, confluence | `docs` |
| anything else | `other` |

Keep the mapping in your emitter, not in the output.

## Workflow

1. Each person runs their agent's emitter -> `usage/<alias>-<agent>.json`.
2. Everyone eyeballs their own blob (it is ~20 lines - read it, confirm nothing leaks).
3. Share the blobs (Slack, gist, shared drive).
4. Anyone runs `compare.mjs usage/*.json` -> collective view + per-person table.
