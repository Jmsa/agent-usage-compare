# agent-usage-compare

Compare how you and your friends use coding agents (Claude Code, Codex, Cursor,
...) without leaking anything confidential.

Everyone works at a different company. The interesting stuff - session counts,
token usage, model + effort mix, work-type breakdown, MCP usage - can be shared
safely as long as the raw transcripts never leave your machine. This is a small
schema plus per-agent emitters that make that safe by construction.

## How it works

1. **Classify locally, share only aggregates.** Your emitter reads your local
   transcripts, classifies each session, and writes *only* a whitelisted set of
   aggregate fields. There is no free-text field to accidentally leak into.
2. **One schema, per-agent emitters.** Each agent has its own log format, so
   each needs its own emitter. They all output the same schema (`SCHEMA.md`), so
   comparisons are apples to apples across agents.
3. **Merge and compare.** `compare.mjs` reads everyone's blobs and prints a
   collective view plus a per-person table - agent-agnostic.

## What is safe to share

Counts and generic buckets only: session count, token totals, work-type
percentages, model families, effort distribution, built-in command counts, and
MCP usage normalized to generic *types* (`issue-tracker`, `browser`, `db`, ...).

Never emitted: session text, PR/ticket IDs, repo/branch/file names, raw MCP
server names, custom command names, or your real name (use an alias). See
`SCHEMA.md` for the full contract.

## Usage

```sh
# Claude Code
node emit-claude-code.mjs --alias you --role dev --days 30 > usage/you-claude-code.json

# eyeball it - it is ~20 lines, confirm nothing leaks
cat usage/you-claude-code.json

# collect everyone's blobs into usage/, then:
node compare.mjs usage/*.json
```

Requires Node 18+. No dependencies.

## Adding another agent

Copy `emit-template.mjs` to `emit-<agent>.mjs`, fill in the "READ YOUR LOGS
HERE" section to parse your agent's transcripts, and emit the same schema. That
is the only per-agent work.

## Files

| file | purpose |
|---|---|
| `SCHEMA.md` | the safe interchange contract (v1) |
| `emit-claude-code.mjs` | Claude Code emitter (reads `~/.claude/projects`) |
| `emit-template.mjs` | starting point for other agents |
| `compare.mjs` | merge N blobs -> collective view + per-person table |

## Privacy note

`usage/` is gitignored so nobody commits their own blob by accident. Share blobs
directly (gist, DM, shared drive), not through this repo, unless you have read
yours and are fine making it public.
