// tau-session-audit — Plan & Failure analysis helpers
// Consumed by audit.ts `--check plan` and `--check failures`.

import type { PatternMatch, SessionEvent } from "../patterns/types";
import type { PlanProgress } from "../providers/types";
import type { Session } from "./audit";

// ─────────────────────────────────────────────────────────────────────────────
// Plan tracking: reconstruct per-session todo progress. tau derives it from
// event payloads; kappa rows carry provider-native plan[] (todo table), which
// takes precedence when present.
// ─────────────────────────────────────────────────────────────────────────────

export type { PlanProgress };

const OP_RE =
	/["'](?:op|action)["']\s*:\s*["'](init|start|done|block|unblock|append|drop|rm)["']/;
const TASK_RE = /["']task["']\s*:\s*["']([^"']{0,90})/;

function extractTodoOps(
	events: SessionEvent[],
): Array<{ op: string; task: string }> {
	const ops: Array<{ op: string; task: string }> = [];
	for (const e of events) {
		const isTodo =
			e.type === "todo" ||
			e.message?.toolName === "todo" ||
			e.data?.toolName === "todo" ||
			(typeof e.type === "string" && e.type.toLowerCase().includes("todo"));
		if (!isTodo) continue;
		const json = JSON.stringify(e);
		const m = json.match(OP_RE);
		if (m) {
			const t = json.match(TASK_RE);
			ops.push({ op: m[1], task: t ? t[1] : "" });
		}
	}
	return ops;
}

/** Reconstruct plan progress for one session from its todo events. */
export function planProgressFor(
	events: SessionEvent[],
	title: string,
): PlanProgress {
	const ops = extractTodoOps(events);
	let open = 0;
	let done = 0;
	let blocked = 0;
	// `init` carries the full list: count its checklist payload.
	for (const { op } of ops) {
		if (op === "init") open += 1;
		else if (op === "done") {
			if (open > 0) open -= 1;
			done += 1;
		} else if (op === "block") blocked += 1;
		else if (op === "unblock") blocked = Math.max(0, blocked - 1);
	}
	const total = done + open;
	const pct = total === 0 ? 0 : Math.round((done / total) * 100);
	const snippet = title.slice(0, 70);
	return { open, done, blocked, total, pct, todoEvents: ops.length, snippet };
}

/** Aggregate plan health across sessions — the `--check plan` payload. */
export function planSummary(
	sessions: Session[],
	eventsByFile: Map<string, SessionEvent[]>,
) {
	const tracked = sessions
		.map((s) => ({
			file: s.file,
			plan: s.plan ?? planProgressFor(eventsByFile.get(s.file) || [], s.title),
		}))
		.filter((r) => r.plan.todoEvents > 0)
		.sort((a, b) => b.plan.total - a.plan.total);
	const totals = tracked.reduce(
		(acc, r) => ({
			open: acc.open + r.plan.open,
			done: acc.done + r.plan.done,
			blocked: acc.blocked + r.plan.blocked,
		}),
		{ open: 0, done: 0, blocked: 0 },
	);
	return { tracked, totals, trackingSessions: tracked.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Failure loops: aggregate REPEATED_COMMAND_LOOP detections by error snippet.
// ─────────────────────────────────────────────────────────────────────────────

export interface FailureLoop {
	snippet: string;
	repeatTotal: number;
	sessions: Array<{ file: string; count: number }>;
}

export function failureLoops(sessions: Session[]): FailureLoop[] {
	const byKey = new Map<string, FailureLoop>();
	for (const s of sessions) {
		for (const p of s.patterns) {
			if (p.patternId !== "REPEATED_COMMAND_LOOP") continue;
			const key = String(p.details.errorSnippet || p.description).slice(0, 140);
			const count = Number(p.details.repeatCount) || 3;
			const el = byKey.get(key) || {
				snippet: key,
				repeatTotal: 0,
				sessions: [],
			};
			el.repeatTotal += count;
			el.sessions.push({ file: s.file, count });
			byKey.set(key, el);
		}
	}
	return [...byKey.values()].sort((a, b) => b.repeatTotal - a.repeatTotal);
}

export function renderFailures(loops: FailureLoop[], limit = 15): string {
	if (loops.length === 0) return "  (no repeated failure loops)";
	return loops
		.slice(0, limit)
		.map(
			(l, i) =>
				`  [${i + 1}] ${l.repeatTotal}x "${l.snippet}"\n       ${l.sessions
					.slice(0, 3)
					.map((s) => `${s.file} (${s.count}x)`)
					.join(
						", ",
					)}${l.sessions.length > 3 ? `, +${l.sessions.length - 3} more` : ""}`,
		)
		.join("\n");
}

export const _patternTypeReexport: PatternMatch[] = [];
