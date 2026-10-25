#!/usr/bin/env bun
// helper/tokentrim.ts — kleio capability: autonomous token-redundancy audit.
//
// Implements the simem/dev.to measurement ("agents read N tokens, most already
// seen") as a first-class kleio check. Loads kappa + tau sessions through the
// existing provider registry (which sees EVERY logged event/tool output), then
// replays each session turn-by-turn to quantify:
//
//   1. RE-READ — tokens of content that were already in context on an earlier
//      turn and are sent again (the "stack of paper" that re-verifies the same
//      text turn after turn).
//   2. TRIMMABLE — tool reports (test/install/build/file-read) classified by
//      how much can be dropped while keeping every failure line.
//   3. AGGREGATE — measured (tokens actually kept out of this replay) vs
//      estimated (tokens never re-sent across later turns).
//
// It never drops a failure line and never changes the underlying logs; it only
// measures. Wire into the audit CLI via `--check trimmability` / `--check reread`.
//
// Usage: bun run helper/audit.ts --check trimmability  (once wired)
//        bun run helper/tokentrim.ts --summary  (standalone report)

import { writeFileSync } from "node:fs";
import { loadAllSessions } from "../providers/registry";
import { rawTauEvents } from "../providers/tau-jsonl";
import { loadKappaSessions } from "../providers/kappa";
import type { Session } from "../providers/types";
import type { SessionEvent } from "../patterns/types";

// ── token estimate ───────────────────────────────────────────────────────────
// ~1 token ≈ 4 chars (approx; the article uses ~¾ word/token ≈ ~4 chars/token).
const CHARS_PER_TOKEN = 4;

function charsOf(value: unknown): number {
	if (value == null) return 0;
	if (typeof value === "string") return value.length;
	return JSON.stringify(value)?.length ?? 0;
}

function tokensOfChars(chars: number): number {
	return Math.round(chars / CHARS_PER_TOKEN);
}

// ── event content extraction ─────────────────────────────────────────────────
// Return the extractable text + a classifier for one SessionEvent.
interface EventContent {
	kind: "tool_report" | "file_read" | "assistant" | "user" | "other";
	tool?: string;
	text: string;
}

function classifyEvent(e: SessionEvent): EventContent {
	const toolName =
		e.data?.toolName ?? e.message?.toolName ?? (e.data?.args?.cmd ? "shell" : "");
	const isTool =
		toolName !== "" ||
		e.type === "tool" ||
		e.type === "tool_call" ||
		e.type === "shell" ||
		eitherRole(e) === "tool";

	// Build the textual payload.
	const payloads: string[] = [];
	if (typeof e.data?.args === "string") payloads.push(e.data.args);
	else if (e.data?.args) payloads.push(JSON.stringify(e.data.args));
	if (Array.isArray(e.message?.content)) {
		for (const c of e.message.content as Array<unknown>) {
			if (typeof c === "string") payloads.push(c);
			else if (c && typeof c === "object") {
				const co = c as Record<string, unknown>;
				if (typeof co.text === "string") payloads.push(co.text);
			}
		}
	} else if (typeof e.message?.content === "string") {
		payloads.push(e.message.content);
	}
	if (typeof e.data?.output === "string") payloads.push(e.data.output);

	const text = payloads.join("\n");

	// Tool report vs assistant vs user decision.
	if (isTool) {
		const lowerTool = toolName.toLowerCase();
		if (/test|vitest|jest|pytest|go test|node --test|npm test/.test(lowerTool))
			return { kind: "tool_report", tool: toolName, text };
		if (/install|npm i|bun add|yarn|pip install|go get|apt/.test(lowerTool))
			return { kind: "tool_report", tool: toolName, text };
		if (/build|compile|tsc|bun build|make|cmake|docker build/.test(lowerTool))
			return { kind: "tool_report", tool: toolName, text };
		if (toolName.toLowerCase().includes("read") || /cat |less |head |tail /.test(text))
			return { kind: "file_read", tool: toolName, text };
		return { kind: "tool_report", tool: toolName, text };
	}

	if (eitherRole(e) === "assistant") return { kind: "assistant", text };
	if (eitherRole(e) === "user") return { kind: "user", text };
	return { kind: "other", text };
}

function eitherRole(e: SessionEvent): string {
	if (e.data && typeof e.data === "object") return (e.data as Record<string, unknown>).role ?? "";
	const m = e.message as Record<string, unknown> | undefined;
	if (m && typeof m === "object") return (m.role as string) ?? "";
	return "";
}

// ── trimmability classifier ──────────────────────────────────────────────────
// The article rule: never drop a failure line. Compiler/test errors kept whole.
export interface TrimEstimate {
	inputChars: number;
	keptChars: number;
	dropPct: number;
	keptFailureLines: number;
	failureLinesTotal: number;
	kind: string;
}

const CONSOLE_PASS = /(✓|ok +\d+|passed|colors=|\d+ passing| success |added \d+ package)/i;
const CONSOLE_FAIL = /(✗|✘|FAIL|Error|error:|failed|AssertionError|Expected:|Received:|✖)/i;

export function estimateTrimmability(content: EventContent): TrimEstimate {
	const lines = content.text.split("\n");
	let failureLines = 0;
	for (const l of lines) if (CONSOLE_FAIL.test(l)) failureLines++;

	if (content.kind !== "tool_report") {
		// File reads / assistant / user text are not auto-trimmed.
		return {
			inputChars: content.text.length,
			keptChars: content.text.length,
			dropPct: 0,
			keptFailureLines: failureLines,
			failureLinesTotal: failureLines,
			kind: content.kind,
		};
	}

	// Tool report: keep every failure(+context) line, drop pure pass-noise.
	if (failureLines > 0) {
		// Keep failure lines AND 1 line of context around each.
		const kept: string[] = [];
		lines.forEach((l, i) => {
			if (CONSOLE_FAIL.test(l)) {
				kept.push(l);
				if (i > 0) kept.push(lines[i - 1]);
				if (i < lines.length - 1) kept.push(lines[i + 1]);
			}
		});
		// Only trim if we actually removed pass-noise; if every line is a
		// failure we keep 100% (the article's 0%-trimmed wall of errors).
		if (kept.length >= lines.length) {
			return {
				inputChars: content.text.length,
				keptChars: content.text.length,
				dropPct: 0,
				keptFailureLines: failureLines,
				failureLinesTotal: failureLines,
				kind: content.kind,
			};
		}
		// Keep summary tail (e.g. "Tests: 340 passed, 1 failed") if present.
		const summary = lines.filter((l) => /Tests:|failures:|Passed|Failed|test.*/i.test(l) && CONSOLE_PASS.test(l)).slice(-3);
		for (const s of summary) if (!kept.includes(s)) kept.push(s);
		const keptChars = kept.join("\n").length;
		return {
			inputChars: content.text.length,
			keptChars,
			dropPct: Math.round((1 - keptChars / Math.max(1, content.text.length)) * 1000) / 10,
			keptFailureLines: failureLines,
			failureLinesTotal: failureLines,
			kind: content.kind,
		};
	}

	// No failure lines — noisy report. Keep last 3 summary lines only.
	if (lines.length > 6) {
		const kept = lines.slice(-3).join("\n");
		return {
			inputChars: content.text.length,
			keptChars: kept.length,
			dropPct: Math.round((1 - kept.length / Math.max(1, content.text.length)) * 1000) / 10,
			keptFailureLines: 0,
			failureLinesTotal: 0,
			kind: content.kind,
		};
	}
	return {
		inputChars: content.text.length,
		keptChars: content.text.length,
		dropPct: 0,
		keptFailureLines: 0,
		failureLinesTotal: 0,
		kind: content.kind,
	};
}

// ── per-session replay (the "stack of paper" cost model) ─────────────────────
export interface ReplayResult {
	file: string;
	turns: number;
	totalTurnChars: number; // sum over turns of chars sent that turn (growing context)
	totalReReadChars: number; // chars sent this turn that were already seen
	trimmableInputChars: number;
	trimmableKeptChars: number;
	byClass: Record<string, { n: number; chars: number; dropPct: number }>;
}

export function replaySession(events: SessionEvent[], file: string): ReplayResult {
	const seen = new Set<string>();
	const windowContent: string[] = [];
	const result: ReplayResult = {
		file,
		turns: 0,
		totalTurnChars: 0,
		totalReReadChars: 0,
		trimmableInputChars: 0,
		trimmableKeptChars: 0,
		byClass: {},
	};

	let currentTurnChars = 0;
	let currentTurnNew = 0;
	let alreadyHashed = 0;

	function flushTurn() {
		result.turns += 1;
		result.totalTurnChars += currentTurnChars;
		result.totalReReadChars += currentTurnChars - currentTurnNew;
		currentTurnChars = 0;
		currentTurnNew = 0;
	}

	for (const e of events) {
		const ec = classifyEvent(e);
		if (ec.text.length === 0) continue;

		// Hash-normalize to catch near-identical repeated content without
		// storing the full text of every command in memory.
		const key = hashText(ec.text);
		const isNew = !seen.has(key);

		// Track per-class trimmability on tool reports.
		if (ec.kind === "tool_report") {
			const est = estimateTrimmability(ec);
			result.trimmableInputChars += est.inputChars;
			result.trimmableKeptChars += est.keptChars;
			if (isNew) {
				const c = (result.byClass[ec.kind] ||= { n: 0, chars: 0, dropPct: 0 });
				c.n += 1;
				c.chars += est.inputChars;
				c.dropPct = c.n > 0 ? Math.round((est.dropPct + (c.dropPct * (c.n - 1))) / c.n) : est.dropPct;
			}
		}

		if (isNew) {
			seen.add(key);
			currentTurnNew += ec.text.length;
			windowContent.push(ec.text);
		} else {
			alreadyHashed += 1;
		}
		currentTurnChars += ec.text.length;
		if (currentTurnChars > 0 && e.timestamp) {
			// Heuristic turn boundary: new assistant tool-call starts a turn.
			if (e.type === "tool_call" || e.type === "tool" || e.type === "assistant") {
				flushTurn();
			}
		}
	}
	flushTurn();

	return result;
}

function hashText(text: string): string {
	let h = 0;
	// byte-ish 32-bit hash; dedupe near-identical (strip trailing whitespace per line)
	const norm = text.replace(/[ \t]+$/gm, "").slice(0, 20000);
	for (let i = 0; i < norm.length; i++) {
		h = (h * 31 + norm.charCodeAt(i)) | 0;
	}
	return norm.length + ":" + h;
}

// ── aggregate across all sessions ────────────────────────────────────────────
export interface AuditReport {
	sessions: number;
	turns: number;
	totalTurnTokens: number;
	totalReReadTokens: number;
	reReadShare: number; // 0..1
	trimmableKeptTokens: number;
	trimmableDropTokens: number;
	trimmableDropPct: number;
	estimatedNotResentTokens: number;
	byClass: Record<string, { n: number; inputTokens: number; keeoPct: number }>;
}

export async function auditAll(): Promise<AuditReport> {
	const rep: AuditReport = {
		sessions: 0,
		turns: 0,
		totalTurnTokens: 0,
		totalReReadTokens: 0,
		reReadShare: 0,
		trimmableKeptTokens: 0,
		trimmableDropTokens: 0,
		trimmableDropPct: 0,
		estimatedNotResentTokens: 0,
		byClass: {},
	};

	const sessions = await loadAllSessions();
	for (const s of sessions) {
		let events: SessionEvent[] | null = null;
		if (s.file.startsWith("kappa:")) {
			// kappa provider sessions carry events in the Session's pattern source;
			// re-read from raw kappa events through the provider.
			events = loadKappaEvents(s.sessionId || s.file);
		} else {
			events = rawTauEvents(s.file);
		}
		if (!events || events.length === 0) continue;

		const r = replaySession(events, s.file);
		rep.sessions += 1;
		rep.turns += r.turns;
		rep.totalTurnTokens += tokensOfChars(r.totalTurnChars);
		rep.totalReReadTokens += tokensOfChars(r.totalReReadChars);
		rep.trimmableKeptTokens += tokensOfChars(r.trimmableKeptChars);
		rep.trimmableDropTokens += tokensOfChars(
			Math.max(0, r.trimmableInputChars - r.trimmableKeptChars),
		);
	}

	rep.reReadShare = rep.totalTurnTokens > 0 ? rep.totalReReadTokens / rep.totalTurnTokens : 0;
	rep.trimmableDropPct =
		rep.trimmableKeptTokens + rep.trimmableDropTokens > 0
			? Math.round(
					(rep.trimmableDropTokens /
						(rep.trimmableKeptTokens + rep.trimmableDropTokens)) *
						1000,
				) / 10
			: 0;
	// Simem-style estimate: whatever stays out of the trimmed context is not
	// re-sent on later turns. Approximation: re-read tokens already removed by
	// trimming ≈ trimmableDrop * average surviving turns.
	rep.estimatedNotResentTokens = Math.round(rep.trimmableDropTokens * (rep.turns / Math.max(1, rep.sessions)));
	return rep;
}

// Load raw kappa events (the kappa provider emits them; small adapter).
export function loadKappaEvents(sessionId: string): SessionEvent[] | null {
	const sessions = loadKappaSessions();
	const s = sessions.find((x: Session) => x.file === sessionId || x.sessionId === sessionId);
	// The kappa provider stores a `patterns` source; if events aren't directly
	// exposed, fall back to a minimal reconstruction from the kappa Session.
	if (!s) return null;
	return (s as unknown as { rawEvents?: SessionEvent[] }).rawEvents ?? null;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
async function main() {
	const args = process.argv.slice(2);
	const wantReport = args.includes("--report");
	const report = await auditAll();

	const out: string[] = [];
	out.push("=".repeat(72));
	out.push("KLEIO TOKEN-REDUNDANCY AUDIT  (simem-style measurement, integrated)");
	out.push("=".repeat(72));
	out.push(`sessions replayed        : ${report.sessions}`);
	out.push(`turns                    : ${report.turns.toLocaleString()}`);
	out.push(`total turn tokens        : ${report.totalTurnTokens.toLocaleString()}`);
	out.push(`re-read tokens           : ${report.totalReReadTokens.toLocaleString()}  (${(report.reReadShare * 100).toFixed(1)}% of context was already seen)`);
	out.push(`trimmable kept tokens    : ${report.trimmableKeptTokens.toLocaleString()}`);
	out.push(`trimmable dropped tokens : ${report.trimmableDropTokens.toLocaleString()}  (${report.trimmableDropPct}% of tool reports)  [MEASURED]`);
	out.push(`est. tokens never re-sent: ${report.estimatedNotResentTokens.toLocaleString()}  [ESTIMATE]`);
	out.push("");
	out.push("by class:");
	for (const [k, v] of Object.entries(report.byClass)) {
		out.push(`  ${k.padEnd(16)} n=${v.n}  input=${v.inputTokens} tokens`);
	}
	out.push("");
	out.push("Every figure is MEASURED from your real kappa+tau logs unless marked ESTIMATE.");
	out.push("No failure line is ever dropped; the underlying logs are never modified.");

	const text = out.join("\n") + "\n";
	if (wantReport) {
		writeFileSync("/home/toxic/.local/share/kappa/plans/kleio-token-audit-report.txt", text, "utf-8");
		console.log("Report written to /home/toxic/.local/share/kappa/plans/kleio-token-audit-report.txt");
	}
	console.log(text);
}

if (import.meta.main) await main();