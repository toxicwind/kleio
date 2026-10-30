#!/usr/bin/env bun
// tau-session-audit — maximal integrated: audit + ML + patterns + report
// Usage: bun run helper/audit.ts [--report] [--check all|intent|completed|plan|patterns|todo-phantom|anomalies|unknown-types|near-empty|model|cwd] [--verbose]

import { writeFileSync } from "node:fs";
import type { SessionEvent } from "../patterns/types";
import { loadAllSessions } from "../providers/registry";
import { rawTauEvents, SESSIONS_ROOT } from "../providers/tau-jsonl";
import type { Session } from "../providers/types";
import {
	failureLoops,
	type PlanProgress,
	planSummary,
	renderFailures,
} from "./analysis";
import { generateMarkdownReport } from "./report";

// sessions live under the agent dir (~/.tau/agent/sessions); ~/.tau/sessions is legacy.
// PI_CODING_AGENT_DIR overrides, matching the engine's own resolution.
/** Raw event payloads per session file (from the tau provider). */
export function rawEventsFor(file: string): SessionEvent[] | null {
	return rawTauEvents(file);
}
export const SESSIONS_DIR = SESSIONS_ROOT;

// Intent/completed/anomaly heuristics live in providers/tau-jsonl.ts now
// (re-exported through the providers barrel for backward-compat imports).
export { computeAnomalyScore, inferCompleted, inferIntent } from "../providers";

// (intent heuristics moved to providers/tau-jsonl.ts)

// (heuristics moved to providers/tau-jsonl.ts; re-exported above)

export async function loadSessions(): Promise<Session[]> {
	// Provider registry: tau JSONL + kappa SQLite (see ../providers). Add a
	// session engine by adding a provider module + registry row.
	return loadAllSessions();
}

function fmt(n: number): string {
	return n.toLocaleString();
}

async function main() {
	const args = process.argv.slice(2);
	const checks = new Set<string>();
	let verbose = false;
	let reportMode = false;
	let saveReportPath = "";
	let searchRegex: RegExp | null = null;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--verbose" || arg === "-v") verbose = true;
		else if (arg === "--report" || arg === "-r") reportMode = true;
		else if (arg.startsWith("--out=")) saveReportPath = arg.slice(6);
		else if (arg.startsWith("--check=")) checks.add(arg.slice(8));
		else if (arg === "--check" || arg === "-c") {
			if (i + 1 < args.length) checks.add(args[++i]);
		} else if (arg.startsWith("--search=")) {
			try {
				searchRegex = new RegExp(arg.slice(9), "i");
			} catch (e) {
				console.error("Invalid search regex:", e);
			}
		} else if (arg === "--search" || arg === "-s") {
			if (i + 1 < args.length) {
				try {
					searchRegex = new RegExp(args[++i], "i");
				} catch (e) {
					console.error("Invalid search regex:", e);
				}
			}
		} else if (arg === "--all" || arg === "-a") checks.add("all");
	}

	if (checks.size === 0 && !reportMode) {
		checks.add("all");
	}
	const runAll = checks.has("all");
	const run = (name: string) => runAll || checks.has(name);

	const sessions = await loadSessions();

	// If searchRegex is provided, filter sessions matching file, title, intent, model, or raw JSON event lines
	let filteredSessions = sessions;
	if (searchRegex) {
		console.log(`🔎 SEARCH REGEX: ${searchRegex.source}\n`);
		filteredSessions = sessions.filter((s) => {
			if (
				searchRegex.test(s.file) ||
				searchRegex.test(s.title) ||
				searchRegex.test(s.intent) ||
				searchRegex.test(s.model) ||
				searchRegex.test(s.cwd)
			) {
				return true;
			}
			// Read raw session file content and check if any line matches searchRegex
			try {
				const raw = rawEventsFor(s.file);
				if (raw)
					return searchRegex.test(raw.map((e) => JSON.stringify(e)).join("\n"));
			} catch {}
			return false;
		});

		console.log(`Found ${filteredSessions.length} matching session(s):\n`);
		for (const s of filteredSessions) {
			console.log(`📁 ${s.file} [Intent: ${s.intent}] [Model: ${s.model}]`);
			try {
				const raw = rawEventsFor(s.file);
				if (raw) {
					const lines = raw.map((e) => JSON.stringify(e));
					let matchNum = 0;
					for (const line of lines) {
						if (searchRegex.test(line)) {
							matchNum++;
							if (matchNum <= 5 || verbose) {
								console.log(`    MATCH: ${line.slice(0, 140)}`);
							}
						}
					}
					if (matchNum > 5 && !verbose) {
						console.log(
							`    ... and ${matchNum - 5} more matching lines (pass --verbose for all)`,
						);
					}
				}
			} catch {}
			console.log();
		}
		return;
	}

	// If reportMode or requested, generate and print/save markdown report
	if (reportMode) {
		const reportMd = generateMarkdownReport(sessions, { verbose });
		if (saveReportPath) {
			writeFileSync(saveReportPath, reportMd, "utf-8");
			console.log(`Report written to ${saveReportPath}`);
		} else {
			console.log(reportMd);
		}
		return;
	}

	const completedCount = sessions.filter((s) => s.completed).length;
	const incompleteCount = sessions.filter((s) => !s.completed).length;
	let hasCritical = false;

	console.log("=".repeat(80));
	console.log("TAU SESSION AUDIT — REPORT FORWARD & PATTERNS INTEGRATED");
	console.log("=".repeat(80));
	console.log();

	// DATAFRAME OUTPUT — TSV
	console.log(
		"file\tevents\ttitle\tmodel\tcwd\tintent\tcompleted\tanomalyScore\tphantom_todos\tpattern_matches\tunknown_types",
	);
	for (const s of sessions) {
		const line = [
			s.file,
			s.events,
			`"${s.title.replace(/"/g, '""')}"`,
			s.model,
			s.cwd,
			s.intent,
			s.completed,
			s.anomalyScore.toFixed(1),
			s.phantomTodoCount,
			s.patterns.length,
			s.types.get("?") || 0,
		].join("\t");
		console.log(line);
	}
	console.log();

	// SUMMARY STATS
	console.log("SUMMARY:");
	console.log(`total_files: ${fmt(sessions.length)}`);
	console.log(
		`total_events: ${fmt(sessions.reduce((sum, s) => sum + s.events, 0))}`,
	);
	console.log(`completed: ${completedCount}`);
	console.log(`incomplete: ${incompleteCount}`);
	console.log(
		`sessions_with_phantom_todos: ${sessions.filter((s) => s.phantomTodoCount > 0).length}`,
	);
	console.log(
		`total_pattern_detections: ${sessions.reduce((sum, s) => sum + s.patterns.length, 0)}`,
	);
	console.log();

	// PATTERN CHECKS
	if (run("patterns") || run("todo-phantom") || runAll) {
		console.log("FIRST-CLASS PATTERN DETECTIONS:");
		const patternSummary = new Map<string, number>();
		for (const s of sessions) {
			for (const p of s.patterns) {
				patternSummary.set(p.name, (patternSummary.get(p.name) || 0) + 1);
			}
		}
		for (const [pname, count] of patternSummary.entries()) {
			console.log(`  ${pname}: ${count} incident(s)`);
		}
		console.log();

		const topPhantom = sessions
			.filter((s) => s.phantomTodoCount > 0)
			.slice(0, 10);
		console.log("TOP SESSIONS WITH PHANTOM TODO COMPLETIONS:");
		for (const s of topPhantom) {
			console.log(
				`  ${s.file} (${s.model}): ${s.phantomTodoCount} phantom todos [Intent: ${s.intent}]`,
			);
		}
		console.log();
	}

	// PLAN PROGRESS — reconstruct todo progress per session
	if (run("plan") || runAll) {
		const eventsByFile = new Map<string, SessionEvent[]>();
		for (const s of sessions) {
			if (s.file.startsWith("kappa:")) continue;
			try {
				const evs = rawEventsFor(s.file);
				if (evs) eventsByFile.set(s.file, evs);
			} catch {
				/* skip unreadable */
			}
		}
		const ps = planSummary(sessions, eventsByFile);
		console.log("PLAN PROGRESS (todo-tracking sessions):");
		console.log(
			`  tracking sessions: ${ps.trackingSessions} | done: ${ps.totals.done} | open: ${ps.totals.open} | blocked: ${ps.totals.blocked}`,
		);
		for (const row of ps.tracked.slice(0, 15)) {
			const p: PlanProgress = row.plan;
			console.log(
				`  [${String(p.pct).padStart(3)}%] ${p.done}/${p.total} done (${p.open} open, ${p.blocked} blocked, ${p.todoEvents} todo events) ${row.file}`,
			);
		}
		console.log();
	}

	// FAILURE LOOPS — aggregate repeated-command loops by error snippet
	if (run("failures") || runAll) {
		console.log("REPEATED FAILURE LOOPS (by error snippet):");
		console.log(renderFailures(failureLoops(sessions)));
		console.log();
	}

	// UNKNOWN TYPES
	if (run("unknown-types") || runAll) {
		console.log("UNKNOWN EVENT TYPES (CRITICAL):");
		for (const s of sessions) {
			if ((s.types.get("?") || 0) > 0) {
				console.log(`  ${s.file}: ${s.types.get("?")} unknown event(s)`);
				hasCritical = true;
			}
		}
		console.log();
	}

	console.log("=".repeat(80));
	console.log(
		`Audit complete: ${fmt(sessions.length)} files analyzed. Use --report for GitHub Markdown report.`,
	);
	if (hasCritical) console.log("⚠ CRITICAL: Unknown event types found");
	process.exit(hasCritical ? 1 : 0);
}

await main();
