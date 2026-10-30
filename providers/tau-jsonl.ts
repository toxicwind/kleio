// providers/tau-jsonl.ts — tau sessions (JSONL under ~/.tau/agent/sessions).
//
// The original engine's walk-and-classify logic, isolated behind the provider
// contract so the audit CLI stays source-agnostic.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runAllPatterns } from "../patterns/index";
import type { SessionEvent } from "../patterns/types";
import type { ProviderSpec, Session } from "./types";

const HOME = process.env.HOME || "/home/toxic";
function resolveTauSessionsDir(): string {
	const raw = process.env.PI_CODING_AGENT_DIR;
	if (raw) {
		const p = join(raw, "sessions");
		if (existsSync(p)) return p;
		const homeP = join(HOME, raw, "sessions");
		if (existsSync(homeP)) return homeP;
	}
	const agentDir = join(HOME, ".tau", "agent", "sessions");
	if (existsSync(agentDir)) return agentDir;
	return join(HOME, ".tau", "sessions");
}

export const SESSIONS_DIR = resolveTauSessionsDir();
export const SESSIONS_ROOT = SESSIONS_DIR;

function extractTitle(events: SessionEvent[]): string {
	for (const e of events)
		if (e.type === "session" && typeof e.title === "string") return e.title;
	return "";
}
function extractModel(events: SessionEvent[]): string {
	for (const e of events)
		if (e.type === "model_change" && typeof e.model === "string")
			return e.model;
	return "";
}
function extractCwd(events: SessionEvent[]): string {
	for (const e of events)
		if (e.type === "session" && typeof e.cwd === "string") return e.cwd;
	return "";
}

export function inferIntent(title: string, model: string, cwd: string): string {
	const t = title.toLowerCase();
	const m = model.toLowerCase();
	const c = cwd.toLowerCase();
	if (t.includes("omp") && t.includes("tau"))
		return "OMP → Tau config migration";
	if (t.includes("groq") || m.includes("groq"))
		return "Groq provider integration";
	if (t.includes("nvidia") || m.includes("nvidia") || m.includes("nemotron"))
		return "NVIDIA config / model setup";
	if (t.includes("session") && t.includes("migrat"))
		return "Session migration (omp → tau)";
	if (t.includes("audit")) return "Audit / verification";
	if (t.includes("bench")) return "Benchmark";
	if (t.includes("subagent") || t.includes("scout"))
		return "Subagent / scout work";
	if (t.includes("hotfix")) return "Hotfix";
	if (t.includes("router")) return "Router config";
	if (t.includes("profile")) return "Profile synthesis";
	if (t.includes("tau") && (t.includes("cli") || t.includes("verif")))
		return "Tau CLI verification";
	if (t.includes("maximal")) return "Maximal dynamic bench";
	if (t.includes("estate")) return "Estate project work";
	if (t.includes("deepwiki")) return "Deepwiki MCP audit";
	if (t.includes("mesh")) return "Mesh deepwiki plan";
	if (t.includes("har")) return "HAR session verification";
	if (t.includes("rsync")) return "Cache migration (rsync)";
	if (t.includes("retrieve")) return "Retrieve tools usage";
	if (t.includes("tau command")) return "Tau command fix";
	if (t.includes("zed") || t.includes("qed")) return "Zed/Qed application fix";
	if (t.includes("bun helper")) return "Bun helper setup";
	if (t.includes("catalog")) return "Estate mutator catalog";
	if (t.includes("matter") || t.includes("bulb")) return "Matter bulb fix";
	if (t.includes("registry") || t.includes("imports"))
		return "Groq registry imports";
	if (t.includes("agent config")) return "Tau agent config";
	if (t.includes("syntax") || t.includes("file errors"))
		return "Syntax/file error fix";
	if (t.includes("bashrc")) return "Bashrc aliases setup";
	if (t.includes("db") || t.includes("database"))
		return "DB setup/confirmation";
	if (t.includes("continue")) return "Continue next task";
	if (c.includes("estate")) return "Estate project work";
	if (c.includes("tau")) return "Tau project work";
	return "General agent work";
}

export function inferCompleted(
	types: Map<string, number>,
	events: number,
	patterns: Array<{ patternId: string; severity: string }>,
): boolean {
	const hasCriticalPhantom = patterns.some(
		(p) =>
			p.patternId === "CONSECUTIVE_TODO_FLURRY" && p.severity === "critical",
	);
	if (hasCriticalPhantom) return false;
	if ((types.get("session_init") || 0) > 0 && events > 20) return true;
	if ((types.get("compaction") || 0) > 0 && events > 50) return true;
	if ((types.get("title_change") || 0) > 0 && events > 30) return true;
	if ((types.get("mode_change") || 0) > 0 && events > 20) return true;
	if (events < 5) return false;
	return false;
}

export function computeAnomalyScore(
	eventsCount: number,
	types: Map<string, number>,
	patterns: Array<{ severity: string }>,
): number {
	let score = 0;
	score += (types.get("?") || 0) * 10;
	if (eventsCount < 5) score += 5;
	score += (types.get("credential_pin") || 0) * 3;
	score += (types.get("ttsr_injection") || 0) * 3;
	score += (types.get("branch_summary") || 0) * 2;
	for (const p of patterns) {
		if (p.severity === "critical") score += 15;
		else if (p.severity === "high") score += 8;
		else if (p.severity === "medium") score += 3;
	}
	return score;
}

function scanDir(dir: string, sessions: Session[]): void {
	if (!existsSync(dir)) return;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			scanDir(full, sessions);
			continue;
		}
		if (!entry.name.endsWith(".jsonl")) continue;
		const lines = readFileSync(full, "utf-8")
			.split("\n")
			.filter((l) => l.trim());
		const events: SessionEvent[] = [];
		for (const line of lines) {
			try {
				events.push(JSON.parse(line));
			} catch {
				/* skip */
			}
		}
		const types = new Map<string, number>();
		for (const e of events)
			types.set(e.type || "?", (types.get(e.type || "?") || 0) + 1);
		const title = extractTitle(events);
		const model = extractModel(events);
		const cwd = extractCwd(events);
		const intent = inferIntent(title, model, cwd);
		const patterns = runAllPatterns(events, { file: full, model, cwd, title });
		let phantomTodoCount = 0;
		for (const p of patterns) {
			if (
				p.patternId === "CONSECUTIVE_TODO_FLURRY" &&
				typeof p.details.consecutiveCount === "number"
			) {
				phantomTodoCount += p.details.consecutiveCount;
			} else if (p.patternId === "MESSAGE_NO_TOOLS_THEN_TODO_DONE") {
				phantomTodoCount += 1;
			}
		}
		sessions.push({
			file: full.replace(SESSIONS_DIR, "").replace(/^\//, ""),
			events: events.length,
			types,
			title,
			model,
			cwd,
			intent,
			completed: inferCompleted(types, events.length, patterns),
			anomalyScore: computeAnomalyScore(events.length, types, patterns),
			patterns,
			phantomTodoCount,
		});
	}
}

/** Raw parsed events for a session file (used by plan/pattern re-analysis). */
export function rawTauEvents(file: string): SessionEvent[] | null {
	if (file.startsWith("kappa:")) return null;
	const full = join(SESSIONS_DIR, file);
	if (!existsSync(full)) return null;
	return readFileSync(full, "utf-8")
		.split("\n")
		.filter((l) => l.trim())
		.map((l) => {
			try {
				return JSON.parse(l) as SessionEvent;
			} catch {
				return null;
			}
		})
		.filter((e): e is SessionEvent => e !== null);
}

export const tauProvider: ProviderSpec = {
	name: "tau",
	label: "tau JSONL",
	load() {
		const sessions: Session[] = [];
		scanDir(SESSIONS_DIR, sessions);
		return sessions;
	},
	rawEvents: rawTauEvents,
};
