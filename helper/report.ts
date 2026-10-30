// tau-session-audit — Report Generator
// Generates GitHub-flavored Markdown reports with deep links and pattern analyses.

import { existsSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PatternMatch } from "../patterns/types";

export interface AuditedSession {
	file: string;
	events: number;
	title: string;
	model: string;
	cwd: string;
	intent: string;
	completed: boolean;
	anomalyScore: number;
	patterns: PatternMatch[];
	phantomTodoCount: number;
	types: Map<string, number>;
}

const GITHUB_BLOB_BASE = "https://github.com/toxicwind/estate/blob/main/";

export function generateMarkdownReport(
	sessions: AuditedSession[],
	_options: { verbose?: boolean } = {},
): string {
	const totalFiles = sessions.length;
	const totalEvents = sessions.reduce((sum, s) => sum + s.events, 0);
	const _totalPatterns = sessions.reduce(
		(sum, s) => sum + s.patterns.length,
		0,
	);

	// Group patterns
	const patternCounts = new Map<string, number>();
	const phantomTodoSessions = sessions.filter((s) => s.phantomTodoCount > 0);
	const criticalSessions = sessions.filter((s) =>
		s.patterns.some((p) => p.severity === "critical"),
	);

	for (const s of sessions) {
		for (const p of s.patterns) {
			patternCounts.set(p.name, (patternCounts.get(p.name) || 0) + 1);
		}
	}

	// Model hallucination stats
	const modelHallucinationStats = new Map<
		string,
		{ total: number; phantomTodos: number; syntaxLeaks: number }
	>();
	for (const s of sessions) {
		const mod = s.model || "unknown";
		const st = modelHallucinationStats.get(mod) || {
			total: 0,
			phantomTodos: 0,
			syntaxLeaks: 0,
		};
		st.total++;
		for (const p of s.patterns) {
			if (
				p.patternId === "MESSAGE_NO_TOOLS_THEN_TODO_DONE" ||
				p.patternId === "CONSECUTIVE_TODO_FLURRY"
			) {
				st.phantomTodos++;
			} else if (p.patternId === "THINKING_LEAK_SYNTAX") {
				st.syntaxLeaks++;
			}
		}
		modelHallucinationStats.set(mod, st);
	}

	const lines: string[] = [];

	lines.push("# 🔍 Tau Session Audit & Monorepo Health Report");
	lines.push("");
	lines.push(
		`> **Audit Run:** \`${new Date().toISOString()}\` | **Total Sessions Audited:** \`${totalFiles}\` | **Total Events:** \`${totalEvents.toLocaleString()}\``,
	);
	lines.push("");
	lines.push("## 🎯 Executive Summary");
	lines.push("");
	lines.push(
		'- **Discovered Primary Anti-Pattern**: Multiple models hallucinating completion by outputting natural-language messages with zero tool calls, followed immediately by firing `todo(op="done")` flurries (up to 24 consecutive calls).',
	);
	lines.push(
		`- **Phantom Todo Completion Rate**: \`${phantomTodoSessions.length}/${totalFiles}\` sessions (${((phantomTodoSessions.length / totalFiles) * 100).toFixed(1)}%) exhibited unearned or flurried todo completions.`,
	);
	lines.push(
		`- **Critical Anomalies Detected**: \`${criticalSessions.length}\` sessions had critical severity pattern violations.`,
	);
	if (existsSync(join("/home/toxic/pens/estate", "projects/toxicwind"))) {
		lines.push(
			`- **Monorepo Structural Finding**: \`projects/toxicwind/\` was created by confused models misinterpreting the username as a package namespace. Intended shared utilities belong under \`packages/utils\`.`,
		);
	} else {
		lines.push(
			`- **Monorepo Structure**: clean at report time (no misnamed \`projects/toxicwind/\` root observed).`,
		);
	}
	lines.push("");
	lines.push("---");
	lines.push("");
	lines.push("## 🚨 Discovered Patterns & Hallucination Taxonomy");
	lines.push("");
	lines.push("| Pattern Name | Severity | Detections | Description |");
	lines.push("|---|:---:|:---:|---|");
	for (const [name, count] of patternCounts.entries()) {
		const badge =
			name.includes("Flurry") || name.includes("No Execution Tools")
				? "🔴 CRITICAL"
				: "🟠 HIGH";
		lines.push(
			`| **${name}** | ${badge} | \`${count}\` | Documented in [\`patterns/\`](${GITHUB_BLOB_BASE}skills/tau-session-audit/patterns/) |`,
		);
	}
	lines.push("");

	lines.push("### 1. The Phantom Todo Completion (Primary Smoking Gun)");
	lines.push("");
	lines.push("Models repeatedly demonstrated the following failure mode:");
	lines.push("1. Initialized an 10–18 item plan in `todo`.");
	lines.push(
		'2. Emitted an assistant message with narrative text / thinking (e.g. *"Now I will run end-to-end tests..."*) with **zero tool calls**.',
	);
	lines.push(
		'3. Fired consecutive `todo(op="done")` tool executions back-to-back without running tests, edits, or commands.',
	);
	lines.push("");
	lines.push("#### Top Sessions with Phantom Todo Flurries:");
	lines.push("");
	lines.push(
		"| Session File | Model | Max Consecutive Todos | Total Tools | Details |",
	);
	lines.push("|---|---|:---:|:---:|---|");

	const sortedPhantom = [...phantomTodoSessions]
		.sort((a, b) => b.phantomTodoCount - a.phantomTodoCount)
		.slice(0, 10);
	for (const s of sortedPhantom) {
		const link = `[\`${s.file}\`](${GITHUB_BLOB_BASE}config/tau/agent/sessions/${s.file})`;
		lines.push(
			`| ${link} | \`${s.model}\` | **${s.phantomTodoCount}** | ${s.events} | Intent: *${s.intent}* |`,
		);
	}
	lines.push("");

	lines.push("---");
	lines.push("");
	lines.push("## 🤖 Model Hallucination & Churn Matrix");
	lines.push("");
	lines.push(
		"Which models were most prone to phantom completions and syntax leaks:",
	);
	lines.push("");
	lines.push(
		"| Model Identifier | Sessions Used | Phantom Todo Incidents | Syntax / Thinking Leaks | Health Verdict |",
	);
	lines.push("|---|:---:|:---:|:---:|:---:|");

	const sortedModels = [...modelHallucinationStats.entries()]
		.filter(([_, st]) => st.total >= 2)
		.sort((a, b) => b[1].phantomTodos - a[1].phantomTodos);

	for (const [mod, st] of sortedModels) {
		let verdict = "🟢 Reliable";
		if (st.phantomTodos >= 10 || st.syntaxLeaks >= 3) {
			verdict = "🔴 High Hallucination Risk";
		} else if (st.phantomTodos > 0 || st.syntaxLeaks > 0) {
			verdict = "🟡 Moderate Risk";
		}
		lines.push(
			`| \`${mod}\` | ${st.total} | **${st.phantomTodos}** | ${st.syntaxLeaks} | ${verdict} |`,
		);
	}
	lines.push("");

	lines.push("---");
	lines.push("");
	lines.push("---");
	lines.push("");
	lines.push("## 🏛️ Monorepo Convention & Workspace Architecture Audit");
	lines.push("");
	lines.push(
		"> Live-computed at report time — only emitted when observed on disk.",
	);
	lines.push("");
	const exists = (rel: string) => existsSync(join("/home/toxic/pens/estate", rel));
	const findings: string[] = [];
	if (exists("projects/toxicwind")) {
		findings.push(
			"- `projects/toxicwind/` exists: models misinterpreted the GitHub username as a package namespace. Shared utilities belong under `packages/utils` (registered in root Bun workspaces).",
		);
		findings.push(
			"  - Resolution: migrate `@toxicwind/*` modules into `packages/utils/` and remove the misnamed root.",
		);
	}
	if (exists("projects") && !exists("projects/tsconfig.json")) {
		findings.push(
			"- `projects/tsconfig.json` is missing — child builds under `projects/*` fail with `error TS5083`.",
		);
	}
	const tauBin = "/home/toxic/.local/bin/tau";
	if (existsSync(tauBin)) {
		try {
			const resolved = realpathSync(tauBin);
			const sz = statSync(resolved).size;
			findings.push(
				`- Binary SSOT: \`${tauBin}\` resolves to \`${resolved}\` (${(sz / 1048576).toFixed(0)} MiB).`,
			);
		} catch {
			/* unreadable — skip */
		}
	}
	if (findings.length) {
		lines.push(...findings);
		lines.push("");
		lines.push("### Next Steps");
		lines.push("");
		lines.push("1. Relocate misnamed modules into the registered workspace.");
		lines.push(
			"2. Enforce verification gate: `tau-session-audit --check patterns` in agent handoffs to catch unearned todo completions before completing turns.",
		);
	} else {
		lines.push("- No workspace misalignment observed at report time.");
	}
	lines.push("");

	return lines.join("\n");
}
