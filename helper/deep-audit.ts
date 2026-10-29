#!/usr/bin/env bun
// helper/deep-audit.ts — maximal deep session audit → dataframe TSV.
//
// Runs through kleio's own provider API (loadAllSessions + rawEvents) and adds
// deeper per-record signal than the base audit CLI:
//   real unknown_types (distinct "?" event types), tool_call_count, tool_density,
//   todo_flurry (consecutive todo-call burst), will_use_then_stop band,
//   near_empty flag, failure timeline (first/last failure + event index),
//   per-pattern severity aggregation.
//
// Usage: bun helper/deep-audit.ts [--out <dir>] [--source tau|kappa|all]
// Emits:  <outdir>/deep-audit.tsv · deep-audit.json · DEEP-FINDINGS.md · deep-bands.json

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadAllSessions } from "../providers/registry";
import type { ResolvedSession } from "../providers/types";
import type { SessionEvent } from "../patterns/types";

const outDir = (() => {
	const flag = process.argv.indexOf("--out");
	if (flag !== -1 && process.argv[flag + 1]) return process.argv[flag + 1]!;
	return "/tmp/kleio-deep";
})();
mkdirSync(outDir, { recursive: true });

const sourceFlag = process.argv.indexOf("--source");
const wanted = sourceFlag !== -1 ? process.argv[sourceFlag + 1] : "all";

// ---- helpers ---------------------------------------------------------------

function failureBand(s: ResolvedSession): string {
	if (!s.completed && s.anomalyScore >= 8) return "blocked-high-anomaly";
	if (!s.completed && (s.events ?? 0) <= 4) return "near-empty";
	if (!s.completed && s.patterns?.some(p => p.patternId === "CONSECUTIVE_TODO_FLURRY")) return "todo-flurry";
	if (!s.completed) return "stalled-intent";
	if (s.patterns && s.patterns.length > 0) return "completed-with-patterns";
	return "ok";
}

/** tool_call_count: events whose type starts with "tool" (tool_call / tool_result family). */
function toolCallCount(events: readonly SessionEvent[]): number {
	return events.filter(e => typeof e.type === "string" && e.type.startsWith("tool")).length;
}

/** consecutive same-type tool-call burst lengths — catches todo flurries and tool spins. */
function burstStats(events: readonly SessionEvent[], typePrefix: string): { maxBurst: number; bursts: number } {
	let maxBurst = 0;
	let bursts = 0;
	let current = 0;
	for (const e of events) {
		const isMatch = typeof e.type === "string" && e.type.startsWith(typePrefix);
		if (isMatch) {
			current++;
			if (current > 1 && current === 2) bursts++;
			if (current > maxBurst) maxBurst = current;
		} else {
			current = 0;
		}
	}
	return { maxBurst, bursts };
}

/** will-use-then-stop: completed=false AND zero tool events AND a todo/intent statement present. */
function willUseThenStop(s: ResolvedSession, events: readonly SessionEvent[]): boolean {
	if (s.completed) return false;
	const tools = toolCallCount(events);
	if (tools > 0) return false;
	const saysIntent = s.patterns?.some(p =>
		p.patternId === "MESSAGE_NO_TOOLS_THEN_TODO_DONE" || p.patternId === "CONSECUTIVE_TODO_FLURRY",
	) ?? false;
	return saysIntent || (s.phantomTodoCount ?? 0) > 0 || (s.events ?? 0) <= 4;
}

/** first/last failure from tool_result events carrying error payloads. */
function failureTimeline(events: readonly SessionEvent[]): { first: string; last: string; count: number } {
	let first: string | undefined;
	let last: string | undefined;
	let count = 0;
	events.forEach((e, i) => {
		const payload = e.payload as Record<string, unknown> | undefined;
		const isError = Boolean(payload?.isError) || Boolean(payload?.error) || e.type === "tool_error";
		if (!isError) return;
		count++;
		const stamp = e.timestamp ?? String(e.index ?? i);
		first ??= stamp;
		last = stamp;
	});
	return { first: first ?? "", last: last ?? "", count };
}

function severityCounts(s: ResolvedSession): { critical: number; high: number; medium: number; low: number } {
	const counts = { critical: 0, high: 0, medium: 0, low: 0 };
	for (const p of s.patterns ?? []) counts[p.severity] = (counts[p.severity] ?? 0) + 1;
	return counts;
}

// ---- main walk ---------------------------------------------------------------

const all = loadAllSessions();
const sessions: ResolvedSession[] = wanted === "all" ? all : all.filter(s => s.source === wanted);

interface DeepRow {
	session: string;
	source: string;
	subagent: boolean;
	events: number;
	title: string;
	model: string;
	cwd: string;
	intent: string;
	completed: boolean;
	anomalyScore: number;
	phantom_todos: number;
	pattern_matches: number;
	pattern_critical: number;
	pattern_high: number;
	pattern_medium: number;
	pattern_low: number;
	unknown_types: number;
	tool_call_count: number;
	tool_density: string;
	max_tool_burst: number;
	max_todo_burst: number;
	failure_count: number;
	first_failure: string;
	last_failure: string;
	failure_band: string;
	will_use_then_stop: boolean;
	title_clean: string;
}

const rows: DeepRow[] = sessions.map(s => {
	const raw = s.rawEvents?.(s.file) ?? [];
	const tools = toolCallCount(raw);
	const toolBurst = burstStats(raw, "tool");
	const todoBurst = burstStats(raw, "todo");
	const failures = failureTimeline(raw);
	const sev = severityCounts(s);
	const unknown = s.types ? Object.entries(s.types).filter(([k]) => k === "?").reduce((a, [, v]) => a + (v as number), 0) : 0;
	const eventCount = s.events ?? raw.length;
	const title = s.title ?? "";
	return {
		session: s.file,
		source: s.source,
		subagent: title.includes("(subagent)"),
		events: eventCount,
		title,
		model: s.model ?? "",
		cwd: s.cwd ?? "",
		intent: s.intent ?? "",
		completed: s.completed,
		anomalyScore: s.anomalyScore ?? 0,
		phantom_todos: s.phantomTodoCount ?? 0,
		pattern_matches: s.patterns?.length ?? 0,
		pattern_critical: sev.critical,
		pattern_high: sev.high,
		pattern_medium: sev.medium,
		pattern_low: sev.low,
		unknown_types: unknown,
		tool_call_count: tools,
		tool_density: eventCount > 0 ? (tools / eventCount).toFixed(3) : "0.000",
		max_tool_burst: toolBurst.maxBurst,
		max_todo_burst: todoBurst.maxBurst,
		failure_count: failures.count,
		first_failure: failures.first,
		last_failure: failures.last,
		failure_band: failureBand(s),
		will_use_then_stop: willUseThenStop(s, raw),
		title_clean: title.replace(/\(subagent\)/, "").replace(/"/g, "").trim(),
	};
});

// ---- emit dataframe ----------------------------------------------------------

const columns = Object.keys(rows[0] ?? { session: "" });
const tsvLines = [columns.join("\t"), ...rows.map(r => columns.map(c => String((r as Record<string, unknown>)[c] ?? "")).join("\t"))];
writeFileSync(join(outDir, "deep-audit.tsv"), tsvLines.join("\n") + "\n");
writeFileSync(join(outDir, "deep-audit.json"), JSON.stringify(rows, null, 2) + "\n");

// ---- grouped findings ---------------------------------------------------------

const byBand = new Map<string, number>();
for (const r of rows) byBand.set(r.failure_band, (byBand.get(r.failure_band) ?? 0) + 1);
const byModel = new Map<string, { total: number; incomplete: number }>();
for (const r of rows) {
	const m = byModel.get(r.model) ?? { total: 0, incomplete: 0 };
	m.total++;
	if (!r.completed) m.incomplete++;
	byModel.set(r.model, m);
}

const stalled = rows.filter(r => r.failure_band === "stalled-intent").sort((a, b) => b.events - a.events).slice(0, 15);
const blocked = rows.filter(r => r.failure_band === "blocked-high-anomaly").sort((a, b) => b.anomalyScore - a.anomalyScore || b.events - a.events).slice(0, 15);
const willStops = rows.filter(r => r.will_use_then_stop);
const flurried = rows.filter(r => r.max_todo_burst >= 5);

const pct = (n: number, d: number) => (d === 0 ? "0%" : `${Math.round((n / d) * 100)}%`);

const findings = `# Deep session audit — ${new Date().toISOString()}

- sessions: ${rows.length} (sources: ${[...new Set(rows.map(r => r.source))].join(", ") || "none"})
- events (declared): ${rows.reduce((a, r) => a + r.events, 0)}
- completed: ${rows.filter(r => r.completed).length} · incomplete: ${rows.filter(r => !r.completed).length} (${pct(rows.filter(r => !r.completed).length, rows.length)})

## Failure bands
${[...byBand.entries()].sort((a, b) => b[1] - a[1]).map(([band, n]) => `- **${band}**: ${n} (${pct(n, rows.length)})`).join("\n")}

## will-use-then-stop sessions: ${willStops.length}
${willStops.slice(0, 20).map(r => `- ${r.session} (${r.events} events, model=${r.model}, phantom=${r.phantom_todos})`).join("\n") || "  (none)"}

## todo-flurry bursts (max burst >= 5): ${flurried.length}
${flurried.slice(0, 10).map(r => `- ${r.session} max_todo_burst=${r.max_todo_burst} band=${r.failure_band}`).join("\n") || "  (none)"}

## Top stalled-intent (incomplete, no todo evidence) — top 15 by events
${stalled.map(r => `- ${r.session} events=${r.events} model=${r.model} tools=${r.tool_call_count} density=${r.tool_density} anomalies=${r.anomalyScore}`).join("\n") || "  (none)"}

## Top blocked-high-anomaly — top 15
${blocked.map(r => `- ${r.session} score=${r.anomalyScore} events=${r.events} model=${r.model} patterns=${r.pattern_matches}`).join("\n") || "  (none)"}

## Incompleteness by model
${[...byModel.entries()].sort((a, b) => b[1].incomplete - a[1].incomplete).slice(0, 12).map(([m, v]) => `- ${m}: ${v.incomplete}/${v.total} incomplete (${pct(v.incomplete, v.total)})`).join("\n")}

## Artifacts
- ${join(outDir, "deep-audit.tsv")}
- ${join(outDir, "deep-audit.json")}
- ${join(outDir, "deep-bands.json")}
`;
writeFileSync(join(outDir, "DEEP-FINDINGS.md"), findings);
writeFileSync(join(outDir, "deep-bands.json"), JSON.stringify(Object.fromEntries(byBand), null, 2) + "\n");

console.log(findings);
console.log(`saved .tsv/.json/.md + bands to ${outDir}`);
