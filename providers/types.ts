// session-audit providers — shared contracts for every session source.
// One provider per engine (tau JSONL, kappa SQLite, …); the registry maps
// source names to loaders so the audit CLI is table-driven, not an if-chain.

import type { PatternMatch, SessionEvent } from "../patterns/types";

export type SessionSource = "tau" | "kappa";

/** Per-session plan progress. tau derives it from todo events; kappa reads its native `todo` table. */
export interface PlanProgress {
	open: number;
	done: number;
	blocked: number;
	total: number;
	pct: number;
	todoEvents: number;
	snippet: string;
}

export interface Session {
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
	/** Present when the provider persists plan state natively (kappa `todo` table). */
	plan?: PlanProgress;
}

export interface ProviderSpec {
	name: SessionSource;
	label: string;
	/** Load all sessions from this source. Returns [] when the source is absent. */
	load(): Session[];
	/** Raw event payloads per session file (for plan/pattern re-analysis). */
	rawEvents?(file: string): SessionEvent[] | null;
}

export interface ResolvedSession extends Session {
	source: SessionSource;
}

export type { SessionEvent };
