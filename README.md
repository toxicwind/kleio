# 📜 Kleio

> **The session historian** — one audit, every agent engine.

Kleio (Κλειώ) — the Greek muse of history — audits sessions across the estate's
coding agents. One report covers **tau** (JSONL) and **kappa** (SQLite), with a
provider architecture that makes a new session engine a one-file addition.

## Why

Before Kleio, session archaeology landed wherever the CLI used that day: tau
sessions in `~/.tau/agent/sessions/**/*.jsonl`, kappa rows inside
`~/.local/share/kappa/kappa-main.db` (SQLite). Three separate problems:

1. **Split memories** — intent/completion questions answered differently per engine.
2. **No cross-engine patterns** — phantom-todo detection, repeated-failure loops and
   model-churn ran on tau only; kappa rows carried `patterns: []`.
3. **No plan tracking** — the estate runs todo-first, but nothing reconstructed
   progress per session after the fact.

Kleio merges them: **one report, one pattern library, one plan view.**

## Architecture

```
kleio/
  helper/            audit CLI (kleio), analysis (plan/failures), report (markdown)
  patterns/          shared detector library (tau + kappa)
  providers/         source adapters, each driven by a schema TOML
    schemas/
      tau.toml       JSONL contract (dir, glob, event-field extraction)
      kappa.toml     SQLite contract (session/message/todo/event/part tables)
    tau-jsonl.ts     walks ~/.tau/agent/sessions
    kappa.ts         reads kappa-main.db: todo table → REAL plan progress,
                     event stream → synthesized SessionEvents
    registry.ts      table-driven loaders (add a source = drop module + schema)
```

The provider registry is the single load surface: `loadAllSessions()` returns
every session tagged with its `source`. The audit CLI, MCP server and report
generator consume the same registry — no engine-specific logic anywhere else.

## Usage

```bash
# CLI (standalone or through the estate symlink)
/home/toxic/pens/olympus/products/kleio/helper/audit.ts --all
kleio --check plan          # merged plan progress (tau-derived + kappa native todos)
kleio --check failures      # repeated failure loops by error snippet
kleio --check patterns      # phantom-todos, failure loops, churn, leaks
kleio --report --out=reports/today.md

# MCP (through thresher :25127)
#   kleio_plan | kleio_failures | kleio_report | kleio_search | kleio_health
```

## Providers

| Source | Schema | Backing store | Plan | Patterns |
|---|---|---|---|---|
| tau | `schemas/tau.toml` | `~/.tau/agent/sessions/**/*.jsonl` | derived from todo events | full library |
| kappa | `schemas/kappa.toml` | `~/.local/share/kappa/kappa-main.db` | native `todo` table | synthesized from `event` stream |

Adding a provider: write `providers/schemas/<name>.toml`, one loader module,
one registry row. The schema TOML declares the source contract so the loader
stays declarative — mirrored after the code-patterns provider architecture.

## Status

- [x] tau + kappa providers behind a table-driven registry
- [x] per-provider schema TOMLs
- [x] merged plan progress (kappa native todos)
- [x] shared pattern library firing on both engines
- [x] MCP server (5 read-only tools) + thresher registration
- [ ] future: codex / opencode / claude-code session providers

## License

MIT — part of the εστία (olympus) Greek lineage.