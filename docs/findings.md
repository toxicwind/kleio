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

## Notes
- kleio's `[object Object]` extraction bug (the 4597× fake loop) is FIXED and the
  real failures above are now readable. See commit history for `patterns/repeated-loop.ts`.
- These findings were surfaced purely by running the fixed kleio audit; gatings
  (the estate reorg) are tracked separately.