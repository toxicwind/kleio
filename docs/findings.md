# kleio-Found Bugs — Tau & Kappa Findings

> Produced by running the **fixed** kleio audit (the 2026-10-24 `[object Object]`
> extraction fix) against real tau+kappa session logs. Every finding is
> evidence-backed from actual session JSONL under `~/.tau/agent/sessions` and
> kleio's `--check failures`/`--check all` output.

## Bug 1 — Tau: advisor tool-denial does not converge, ~261× repeated loop

**Severity:** High. **Pattern:** `REPEATED_COMMAND_LOOP`.

**Evidence (kleio, real data):**

```
REPEATED FAILURE LOOPS (by error snippet):
  [1] 261x "Tool bash not found {...}"
  [2] 202x "<system-reminder reason="rule_violation" rule="no-output-truncation" ..."
  [3] 136x "Missing file target: start the payload with *** Edit File ..."
  [4] 113x "Command aborted {...}"
  [5] 84x "Validation failed for tool "bash": - command: command must be a string ..."
```

**Root-cause trace** (from `~/.tau/agent/sessions/-tmp/2026-10-24T16-58-…jsonl`, 3×
"Tool bash not found"):

- Model emits `tool=bash` with `args={command:"cd …; git status …"}` (line 462).
- Tau answers with a toolResult whose text is literally `"Tool bash not found"` and
  echoes it on the next 2 lines (463–464).
- The model repeats the identical `bash` call → "not found" loop, 261× total across
  sessions.

**Code path:** `packages/coding-agent/src/advisor/runtime.ts:144` documents that a
tool the advisor was not granted gets a "self-correcting `Tool <name> not found`
result." The bug: this denial is **not self-correcting in practice** — the model
keeps re-invoking the denied `bash` tool instead of switching, producing a
persistent 200+ repetition loop and burning tokens. Likely fix surface: strengthen
the denial (return a strongly-worded, adaption-forcing error naming the available
alternatives), or gate on a loop counter and force a model-context update after N
consecutive same-tool denials.

**Also implicated:** `84x "Validation failed for tool bash"` and split
`113x "Command aborted"` — both point at the `bash` tool's arg-validation and the
abort path interacting badly with repeated denial.

## Bug 2 — Tau: `rule_violation: no-output-truncation` fires 202× (output-truncation policy)

**Severity:** Medium. Sessions repeatedly trip `system-reminder
reason="rule_violation" rule="no-output-truncation"`. Either the agent's output is
being truncated against an over-strict ceiling, or the policy is self-defeating
for large tool reports. Mitigate by routing large outputs through simem-style
trimming (see `helper/tokentrim.ts`) rather than hard truncation.

## Bug 3 — Kappa: (verify) — kleio sees 279 kappa sessions, 0 unknown event types

**Severity:** Info. kleio reports **0 unknown event types** across both tau+kappa —
the tau/kappa schemas are complete. No schema-extraction bug in the providers.

## Bug 4 — Tau oxlint gate was broken by a parse error + never-formatted tree (FIXED)

**Severity:** High (gate). `check:tools` exit-1 with zero rule-coded errors because
`tau-extensions/packages/tau-loops/src/model-audit.ts:367` declared
`const estate-scriptsAgentConfig` — a hyphen in a JS identifier, a hard parser error.
Fixes applied + pushed to tau `main` (`6ad8e0dcad`):

- Renamed to `estateScriptsAgentConfig`.
- Surface `lastError` in the all-classifiers-failed warning + `const labelParts`
  in the duplicated omp-model-router plugin trees.
- oxfmt-normalized 287 files so `check:tools` (oxlint + oxfmt --check) is clean.

## Bug 5 — `@tau/tau-agent` is a PHANTOM dependency (definitive root cause)

**Root cause:** the modern tau agent package in this checkout is
**`@tau/tau-agent-core` (`packages/agent`, version 18.3.0)**. `@tau/tau-agent`
**does not exist** anywhere — not in the tau root `packages/*` workspace, not
published on npm (404). Yet tau-extensions and tau-marketplace reference it:

- `@tau/tau-agent@18.8.0` exact (omp-model-router) — a version **higher than
  core's 18.3.0**, i.e. a phantom 18.8.0 that was never shipped.
- `@tau/tau-agent@^18.0.x`, `>=16`, `*` across omp-edit-committer, omp-kafka,
  rawhide, tau-flocksync, tau-loops.

**Why it broke:** the OMP-era `@tau/tau-agent` was renamed to `@tau/tau-agent-core`
during modernization; the extensions were never repointed and even pin a
non-existent `18.8.0`. `bun install` in tau-extensions cannot resolve it, so
`@types/bun` (devDep) never installs → LSP `Cannot find name 'Bun'` at
`packages/tau-loops/src/model-audit.ts:291`.

**Resolution (not done — needs API-drift mapping):** repoint every
`@tau/tau-agent` dep across tau-extensions/tau-marketplace to
`@tau/tau-agent-core@18.3.0` (or the alias) and fix the API drift the rename
implied. A plain workspace alias does NOT satisfy the exact `18.8.0` pin
(bun prefers the concrete range over a catalog alias). Do NOT add the
extension/plugin trees to the tau root `packages` glob until the duplicate
`@cakriwut/omp-model-router` name collision (both tau-marketplace and
tau-extensions declare the same name) is resolved. i.e. this is a deliberate
API-mapping task, not a lock-file/workspace-glob task.

## Bug 6 — Kappa: hardcoded forgeable `alg:none` JWT as the hodos provider key (FIXED)

`~/.config/kappa/kappa.jsonc` (tracked in `toxicwind/ii`, `dots/.config/kappa/`) had a
literal committed API key: an `alg:none` JWT
`{"sub":"flock-client","name":"corral-jwtfmt","iat":1791900000}` — header
`{"alg":"none","typ":"JWT"}` — i.e. a token **anyone can forge** (no signature
verification), sitting in `provider.hodos.options.apiKey`. This violates the estate
secrets-SSOT doctrine ("a literal token in a config is a bug"). Replaced with
`{env:FLOCK_API_KEY}`, matching the config's own `{env:...}` convention
(FREEINFERENCE_API_KEY, NIM_PROXY_KEY). Committed `3e0f3e0` on ii `main`. Not in
git history (added post-last-commit), so no scrub required.

## Bug 7 — Kairos 2s-guard hook was INERT (stale estate/bin paths) — FIXED (TDD)

`kairos` (pens/olympus/products/kairos), the estate's 2-second-rule enforcer, emitted
a bash shim hardcoding removed paths: `$HOME/estate/bin/run-fast`,
`$HOME/estate/ranch/kairos/bin/kairos`, `/home/toxic/estate/bin/delend-code-race`.
After the estate reorg dissolved estate/bin, RF_BIN resolved to nothing and the shim
`return 0`'d — so the entire 2s guard hook was silent/inert for every agent command.
Repointed `src/init.ts` + `src/runner.ts` to `$HOME/pens/barn/estate-ops/run-fast` +
`delend-code-race` (+ `~/.local/bin/run-fast` fallback), regenerated `shim.sh`, added 3
TDD shim-path tests. `delend-code-race` self-tested working (sub-2s PASS). Commit
`42b5e0e` on toxicwind/kairos. 15 tests pass.

## Bug 8 — tau and kappa load AGENTS.md by DIFFERENT rules (no single master)

Discovered the two agents' instruction-loading paths so the estate can enforce a
SINGLE authoritative AGENTS.md:

- **TAU**: `packages/coding-agent/src/sdk.ts:904 discoverContextFiles` →
  `loadContextFilesInternal` — walks UP from cwd, surfacing the AGENTS.md
  hierarchy (monorepo support in `capability/context-file.ts`); sorted by depth
  (farther-from-cwd first = "higher priority"). The project root's AGENTS.md is
  included when cwd is under it.
- **KAPPA**: `kappa-code/packages/core/src/instruction-context.ts:58` —
  `fetoca dedupe([global.config/AGENTS.md, ...discovered])` where `discovered`
  = `fs.up({targets:["AGENTS.md"], start, stop})` walking up from the project
  dir. Kappa ALSO loads a **config-dir AGENTS.md** (`global.config/AGENTS.md`,
  i.e. `~/.config/kappa/AGENTS.md`) at the FRONT (highest priority), which
  tau does not. Kappa also has `.kilo/rules/race-gate.md` which "outranks
  AGENTS.md".

**Divergence / master gap:** tau and kappa resolve overlapping-but-not-identical
sets. tau has no config-dir AGENTS.md hook; kappa's config-dir prepend gives it an
estate-wide hook tau lacks. To make ONE authoritative AGENTS.md:

- Point both at the same file (cwd walk-up already surfaces `/home/toxic/AGENTS.md`
  when running under `/home/toxic`).
- Either teach tau the config-dir prepend (kappa's pattern), or drop kappa's
  config-dir prepend to match tau's pure walk-up. The reconcile-* + bin TDD
  scaffold should assert the two resolve identically.

## Notes

- kleio's `[object Object]` extraction bug (the 4597× fake loop) is FIXED and the
  real failures above are now readable. See commit history for `patterns/repeated-loop.ts`.
- These findings were surfaced purely by running the fixed kleio audit; gatings
  (the estate reorg) are tracked separately.
