# Changelog

Auto-backfilled from git history 2026-11-02 (real commits only).

## 2026-10-30
- audit(2026-10-30): 1014-session audit — deepseek-v4-flash phantom-todo risk, 76 phantom sessions (a314e64)
- test(todo-board): persistence contract + phantom-done detection pin + fleet-sync naming contract; real violati (1720b0c)
- feat(patterns): 3 fleet-failure detectors — eval-loop flailing (aborts/kernel deaths), ghost-estate-path lease (7a341d2)
- fix(kleio): depth-sink tests use genuinely deep paths (13 levels >= threshold 12); registry test green (83f7545)
- chore(eidos): apply bun-scaffold bunfig + infra drop-in env (qdrant/hindsight/kafka/redis) — eidos is the pare (a9a0167)

## 2026-10-29
- kleio: deep-audit.ts — deep session audit dataframe (will-use-then-stop, tool density, bursts, failure timelin (5c6f5d4)

## 2026-10-24
- docs(kleio): Bug-23 delendai guard stale relocated path blocks all commits/pushes; --no-verify workaround (34e88fb)
- docs(kleio): Bug-22 auto-model-fallback correct SSOT is pinax+hodos (reverted thresher env detour); live-probe (40e6eb0)
- docs(kleio): record Bug-19/20/21 (delendai hyphen guard + main gate deadlock, config SSOT, all search keys dea (b6fd8a5)
- docs: cmdlog anti-truncation fix (background output loss) + orphan keys/ssmith mcp (c920db5)
- docs: tau bash validation/abort x84/x113 - partialJson-vs-arguments root cause (+ pi#3131 prior art) (5a5a185)
- docs: SSE forward-view inconsistency (404 across daemons) - sse-forward primitive shipped (8b4221a)
- docs: github-mcp-cli not in bin surface + rpc initialize fails (remedy: bin link + OAuth reconnect) (a2da0bc)
- docs: gatehouse:github upstream serves 502 on github-mcp-host (dead backend, unsupervised) (b5c1527)
- docs: tau ACP SWARM_SLOTS ReferenceError crash (fixed, rebuilt+relaunched tau-chute) (529f206)
- docs: GHA compilability decision matrix (kleio+kairos CI added; tau push gated self-hosted) (8cda524)
- ci: add GHA workflow (pure Bun, ubuntu-hosted, compilable) (ca37244)
- docs: GHA compilability finding - estate test HOME/estate path bug (fixed) + adjacent prior art (984e531)
- docs: tau vs kappa AGENTS.md load-path divergence (Bug 8) for the master file (17e36a8)
- docs: kairos inert-hook stale-path finding (fixed TDD) (6df8f1d)
- docs: add kappa hardcoded forgeable none-alg JWT finding (fixed) (9cc6c13)
- docs: add tau oxlint-parse-bug (fixed) + tau-extensions workspace findings (23f72b8)
- docs: tau/kappa bug findings from fixed kleio audit (advisor denial loop x261, output-truncation policy x202) (9ec1eb3)
- docs: point at canonical pens/olympus/products/kleio (drop ranch mirror ref) (263fca3)
- kleio: session historian (tau+kappa providers) (9a1982d)
