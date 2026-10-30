# 🔍 Tau Session Audit & Monorepo Health Report

> **Audit Run:** `2026-10-30T23:22:37.336Z` | **Total Sessions Audited:** `1014` | **Total Events:** `327,345`

## 🎯 Executive Summary

- **Discovered Primary Anti-Pattern**: Multiple models hallucinating completion by outputting natural-language messages with zero tool calls, followed immediately by firing `todo(op="done")` flurries (up to 24 consecutive calls).
- **Phantom Todo Completion Rate**: `76/1014` sessions (7.5%) exhibited unearned or flurried todo completions.
- **Critical Anomalies Detected**: `138` sessions had critical severity pattern violations.
- **Monorepo Structure**: clean at report time (no misnamed `projects/toxicwind/` root observed).

---

## 🚨 Discovered Patterns & Hallucination Taxonomy

| Pattern Name | Severity | Detections | Description |
|---|:---:|:---:|---|
| **Repeated Tool Failure Loop** | 🟠 HIGH | `372` | Documented in [`patterns/`](https://github.com/toxicwind/estate/blob/main/skills/tau-session-audit/patterns/) |
| **Ghost /home/toxic/estate Path (lease violation)** | 🟠 HIGH | `18578` | Documented in [`patterns/`](https://github.com/toxicwind/estate/blob/main/skills/tau-session-audit/patterns/) |
| **Rapid Consecutive Todo Done Flurry Without Intervening Work** | 🔴 CRITICAL | `285` | Documented in [`patterns/`](https://github.com/toxicwind/estate/blob/main/skills/tau-session-audit/patterns/) |
| **Todo Marked Done Immediately After Tool Failure** | 🟠 HIGH | `59` | Documented in [`patterns/`](https://github.com/toxicwind/estate/blob/main/skills/tau-session-audit/patterns/) |
| **Unexecuted Scratchpad or Pseudo-Tool Syntax in Chat** | 🟠 HIGH | `7` | Documented in [`patterns/`](https://github.com/toxicwind/estate/blob/main/skills/tau-session-audit/patterns/) |
| **High Model Churn Session** | 🟠 HIGH | `97` | Documented in [`patterns/`](https://github.com/toxicwind/estate/blob/main/skills/tau-session-audit/patterns/) |
| **Eval Loop Flailing (repeated aborts, no progress)** | 🟠 HIGH | `2` | Documented in [`patterns/`](https://github.com/toxicwind/estate/blob/main/skills/tau-session-audit/patterns/) |
| **Message with No Execution Tools Followed by Todo Done** | 🔴 CRITICAL | `17` | Documented in [`patterns/`](https://github.com/toxicwind/estate/blob/main/skills/tau-session-audit/patterns/) |
| **Defensive Completion Escape After User Brain-Dump / Clarifications** | 🟠 HIGH | `1` | Documented in [`patterns/`](https://github.com/toxicwind/estate/blob/main/skills/tau-session-audit/patterns/) |

### 1. The Phantom Todo Completion (Primary Smoking Gun)

Models repeatedly demonstrated the following failure mode:
1. Initialized an 10–18 item plan in `todo`.
2. Emitted an assistant message with narrative text / thinking (e.g. *"Now I will run end-to-end tests..."*) with **zero tool calls**.
3. Fired consecutive `todo(op="done")` tool executions back-to-back without running tests, edits, or commands.

#### Top Sessions with Phantom Todo Flurries:

| Session File | Model | Max Consecutive Todos | Total Tools | Details |
|---|---|:---:|:---:|---|
| [`-tmp/2026-10-28T09-48-18-108Z_01a181e9-133c-77f4-a44d-0d9f6757c0a8.jsonl`](https://github.com/toxicwind/estate/blob/main/config/tau/agent/sessions/-tmp/2026-10-28T09-48-18-108Z_01a181e9-133c-77f4-a44d-0d9f6757c0a8.jsonl) | `nvidia/nvidia/nemotron-3-ultra-550b-a55b` | **117** | 5017 | Intent: *NVIDIA config / model setup* |
| [`-tmp/2026-10-23T22-25-26-764Z_01a16ade-76ec-741f-ae18-35b3107fe09d.jsonl`](https://github.com/toxicwind/estate/blob/main/config/tau/agent/sessions/-tmp/2026-10-23T22-25-26-764Z_01a16ade-76ec-741f-ae18-35b3107fe09d.jsonl) | `freeinference/glm-5.3-flash` | **112** | 4655 | Intent: *General agent work* |
| [`-tmp/2026-10-30T02-25-24-800Z_01a18aa0-5140-701e-b8be-15334a1ce009.jsonl`](https://github.com/toxicwind/estate/blob/main/config/tau/agent/sessions/-tmp/2026-10-30T02-25-24-800Z_01a18aa0-5140-701e-b8be-15334a1ce009.jsonl) | `freeinference/glm-5.3-flash` | **102** | 7898 | Intent: *General agent work* |
| [`-tmp/2026-10-28T20-58-57-421Z_01a1844f-140d-72d0-84c9-0b33a8a613c3.jsonl`](https://github.com/toxicwind/estate/blob/main/config/tau/agent/sessions/-tmp/2026-10-28T20-58-57-421Z_01a1844f-140d-72d0-84c9-0b33a8a613c3.jsonl) | `freeinference/deepseek-v4-flash` | **82** | 2782 | Intent: *General agent work* |
| [`-tmp/2026-10-28T08-10-14-943Z_01a1818f-4e1f-712c-b8f1-e377943e39aa.jsonl`](https://github.com/toxicwind/estate/blob/main/config/tau/agent/sessions/-tmp/2026-10-28T08-10-14-943Z_01a1818f-4e1f-712c-b8f1-e377943e39aa.jsonl) | `nvidia/nvidia/nemotron-3-ultra-550b-a55b` | **78** | 3912 | Intent: *NVIDIA config / model setup* |
| [`-tmp/2026-10-27T23-18-31-962Z_01a17fa8-811a-710c-94de-5deb4197fe60.jsonl`](https://github.com/toxicwind/estate/blob/main/config/tau/agent/sessions/-tmp/2026-10-27T23-18-31-962Z_01a17fa8-811a-710c-94de-5deb4197fe60.jsonl) | `rhodochrosite/models/gemini-flash-tool-retrieval` | **56** | 5546 | Intent: *General agent work* |
| [`-tmp/2026-10-21T04-29-39-593Z_01a15cb8-d589-7499-beab-3b41ace5200e.jsonl`](https://github.com/toxicwind/estate/blob/main/config/tau/agent/sessions/-tmp/2026-10-21T04-29-39-593Z_01a15cb8-d589-7499-beab-3b41ace5200e.jsonl) | `google-antigravity/claude-opus-5-5-high` | **40** | 3667 | Intent: *General agent work* |
| [`-tmp/2026-10-24T16-58-01-451Z_01a16ed9-0f6b-74de-8f2c-1226eb3104b0.jsonl`](https://github.com/toxicwind/estate/blob/main/config/tau/agent/sessions/-tmp/2026-10-24T16-58-01-451Z_01a16ed9-0f6b-74de-8f2c-1226eb3104b0.jsonl) | `freeinference/qwen3.6-35b` | **35** | 1084 | Intent: *General agent work* |
| [`-tmp/2026-10-11T21-55-16-455Z_01a12cf6-8767-735c-82dd-7668788e3520.jsonl`](https://github.com/toxicwind/estate/blob/main/config/tau/agent/sessions/-tmp/2026-10-11T21-55-16-455Z_01a12cf6-8767-735c-82dd-7668788e3520.jsonl) | `cohere/command-a-plus-05-2026` | **33** | 1979 | Intent: *General agent work* |
| [`-tmp/2026-10-30T22-00-43-302Z_01a18ed4-5826-7720-bf7c-741a608ff09a.jsonl`](https://github.com/toxicwind/estate/blob/main/config/tau/agent/sessions/-tmp/2026-10-30T22-00-43-302Z_01a18ed4-5826-7720-bf7c-741a608ff09a.jsonl) | `openrouter/dots-studio/dots-3-note-preview:free` | **31** | 1534 | Intent: *DB setup/confirmation* |

---

## 🤖 Model Hallucination & Churn Matrix

Which models were most prone to phantom completions and syntax leaks:

| Model Identifier | Sessions Used | Phantom Todo Incidents | Syntax / Thinking Leaks | Health Verdict |
|---|:---:|:---:|:---:|:---:|
| `freeinference/deepseek-v4-flash` | 172 | **54** | 1 | 🔴 High Hallucination Risk |
| `freeinference/glm-5.3-flash` | 29 | **48** | 0 | 🔴 High Hallucination Risk |
| `nvidia/nvidia/nemotron-3-ultra-550b-a55b` | 18 | **40** | 0 | 🔴 High Hallucination Risk |
| `rhodochrosite/models/gemini-flash-tool-retrieval` | 2 | **18** | 0 | 🔴 High Hallucination Risk |
| `freeinference/qwen3.6-35b` | 262 | **17** | 0 | 🔴 High Hallucination Risk |
| `openrouter/dots-studio/dots-3-note-preview:free` | 14 | **12** | 0 | 🔴 High Hallucination Risk |
| `cohere/command-a-plus-05-2026` | 2 | **9** | 0 | 🟡 Moderate Risk |
| `google-antigravity/gemini-3.5-flash-lite` | 10 | **8** | 0 | 🟡 Moderate Risk |
| `freeinference/minimax-m3` | 15 | **7** | 0 | 🟡 Moderate Risk |
| `openrouter/nvidia/nemotron-3.5-lightning:free` | 32 | **5** | 0 | 🟡 Moderate Risk |
| `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free` | 2 | **5** | 0 | 🟡 Moderate Risk |
| `omni/oc/longcat-2.5-preview-free` | 5 | **5** | 0 | 🟡 Moderate Risk |
| `google-antigravity/gemini-3.8-flash` | 11 | **4** | 0 | 🟡 Moderate Risk |
| `nvidia/mistralai/mistral-7b-instruct-v03` | 3 | **4** | 0 | 🟡 Moderate Risk |
| `github-copilot/gpt-5.1-codex` | 3 | **3** | 0 | 🟡 Moderate Risk |
| `vercel-ai-gateway/inclusionai/ling-3.1-flash` | 14 | **3** | 1 | 🟡 Moderate Risk |
| `openrouter/stealth/space-bunny-alpha` | 27 | **3** | 3 | 🔴 High Hallucination Risk |
| `flock/z-ai/glm-5.3-flash` | 3 | **3** | 0 | 🟡 Moderate Risk |
| `cerebras/zai-glm-4.6` | 5 | **3** | 0 | 🟡 Moderate Risk |
| `flock/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | 26 | **3** | 0 | 🟡 Moderate Risk |
| `unknown` | 93 | **2** | 2 | 🟡 Moderate Risk |
| `vercel-ai-gateway/moonshotai/kimi-k3` | 5 | **2** | 0 | 🟡 Moderate Risk |
| `anthropic/claude-opus-5-5` | 15 | **2** | 0 | 🟡 Moderate Risk |
| `cerebras/zai-glm-4.7` | 6 | **2** | 0 | 🟡 Moderate Risk |
| `vercel-ai-gateway/poolside/laguna-s-2.1-free` | 11 | **2** | 0 | 🟡 Moderate Risk |
| `abliteration/abliterated-model` | 2 | **1** | 0 | 🟡 Moderate Risk |
| `moonshot/moonshot-v1-auto` | 2 | **1** | 0 | 🟡 Moderate Risk |
| `vercel-ai-gateway/inclusionai/ling-3.1-flash-free` | 6 | **1** | 0 | 🟡 Moderate Risk |
| `nvidia/nvidia/nemotron-3.5-super-vl-120b-a12b` | 9 | **1** | 0 | 🟡 Moderate Risk |
| `github-copilot/gpt-5.5` | 3 | **1** | 0 | 🟡 Moderate Risk |
| `nvidia/minimaxai/minimax-m3` | 5 | **1** | 0 | 🟡 Moderate Risk |
| `kappa/kilo-auto/free` | 17 | **0** | 0 | 🟢 Reliable |
| `nvidia/z-ai/glm-5.3-flash` | 8 | **0** | 0 | 🟢 Reliable |
| `vercel-ai-gateway/minimax/minimax-m3-free` | 4 | **0** | 0 | 🟢 Reliable |
| `zen/space-bunny-free` | 2 | **0** | 0 | 🟢 Reliable |
| `nvidia/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | 5 | **0** | 0 | 🟢 Reliable |
| `rhodochrosite/estate/fast` | 2 | **0** | 0 | 🟢 Reliable |
| `freeinference/minimax-m3.1-flash` | 9 | **0** | 0 | 🟢 Reliable |
| `flock/nvidia/nemotron-3.5-super-vl-120b-a12b` | 2 | **0** | 0 | 🟢 Reliable |
| `openrouter/liquid/lfm-2.5-2.6b:free` | 6 | **0** | 0 | 🟢 Reliable |
| `flock/nvidia/nemotron-3-ultra-550b-a55b` | 2 | **0** | 0 | 🟢 Reliable |
| `vercel-ai-gateway/spacexai/grok-4.1-fast-reasoning` | 2 | **0** | 0 | 🟢 Reliable |
| `cerebras/qwen-3.8-27b` | 3 | **0** | 0 | 🟢 Reliable |
| `vercel-ai-gateway/inclusionai/ling-3.0-flash-sante-free` | 3 | **0** | 0 | 🟢 Reliable |
| `nvidia/nvidia/nemotron-3-super-120b-a12b` | 11 | **0** | 0 | 🟢 Reliable |
| `zenmux/z-ai/glm-5.3-free` | 2 | **0** | 0 | 🟢 Reliable |
| `openrouter/deepseek/deepseek-v4.1-flash` | 3 | **0** | 0 | 🟢 Reliable |
| `flock/stealth/space-bunny-alpha` | 2 | **0** | 0 | 🟢 Reliable |
| `openrouter/qwen/qwen3.6-flash` | 3 | **0** | 0 | 🟢 Reliable |
| `openrouter/qwen/qwen3.6-35b-a3b` | 4 | **0** | 0 | 🟢 Reliable |
| `openrouter/qwen/qwen3.7-flash` | 2 | **0** | 0 | 🟢 Reliable |
| `groq/openai/gpt-oss-120b` | 2 | **0** | 0 | 🟢 Reliable |
| `groq/openai/gpt-oss-20b` | 4 | **0** | 0 | 🟢 Reliable |
| `groq/qwen/qwen3.8-27b` | 9 | **0** | 0 | 🟢 Reliable |
| `openrouter/nvidia/nemotron-3-super-120b-a12b:free` | 4 | **0** | 0 | 🟢 Reliable |
| `groq/llama-3.1-8b-instant` | 3 | **0** | 0 | 🟢 Reliable |
| `cerebras/llama3.1-8b` | 5 | **0** | 0 | 🟢 Reliable |
| `groq/llama-3.3-70b-versatile` | 4 | **0** | 0 | 🟢 Reliable |
| `zai/glm-5.3-flash` | 2 | **0** | 0 | 🟢 Reliable |
| `openrouter/qwen/qwen3-coder` | 2 | **0** | 0 | 🟢 Reliable |
| `github-copilot/gpt-5` | 2 | **0** | 0 | 🟢 Reliable |
| `huggingface/Qwen/Qwen3.5-9B` | 2 | **0** | 0 | 🟢 Reliable |
| `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b` | 6 | **0** | 0 | 🟢 Reliable |
| `nvidia/meta/llama-3.1-70b-instruct` | 2 | **0** | 0 | 🟢 Reliable |
| `nvidia/meta/llama-3.3-70b-instruct` | 2 | **0** | 0 | 🟢 Reliable |
| `openrouter/deepseek/deepseek-chat` | 5 | **0** | 0 | 🟢 Reliable |
| `nvidia/nvidia/nemotron-parse-2.0` | 4 | **0** | 0 | 🟢 Reliable |
| `openai/gpt-4o-mini` | 3 | **0** | 0 | 🟢 Reliable |
| `flock/~z-ai/glm-latest` | 2 | **0** | 0 | 🟢 Reliable |
| `anthropic/claude-opus-4-8` | 2 | **0** | 0 | 🟢 Reliable |
| `hodos/qwen3.6-35b` | 4 | **0** | 0 | 🟢 Reliable |
| `flock/nvidia/nemotron-3.5-lightning-30b-a3b` | 2 | **0** | 0 | 🟢 Reliable |

---

---

## 🏛️ Monorepo Convention & Workspace Architecture Audit

> Live-computed at report time — only emitted when observed on disk.

- Binary SSOT: `/home/toxic/.local/bin/tau` resolves to `/home/toxic/pens/olympus/products/tau/packages/coding-agent/dist/tau` (328 MiB).

### Next Steps

1. Relocate misnamed modules into the registered workspace.
2. Enforce verification gate: `tau-session-audit --check patterns` in agent handoffs to catch unearned todo completions before completing turns.
