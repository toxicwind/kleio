#!/usr/bin/env bun
// RETIRED 2026-10-23 → providers/kappa.ts (session-source provider modularization).
// kappa-source — adapter that reads kappa-code sessions (SQLite at
// ~/.local/share/kappa/kappa-main.db) and emits them in the tau-session-audit
// `Session` shape, so ONE audit covers both engines. Merged into
// tau-session-audit 2026-10-19 (kappa sessions live in SQLite, not JSONL).

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runAllPatterns } from "../patterns/index";
import type { SessionEvent } from "../patterns/types";
import type { Session } from "./audit";

const KAPPA_DB = join(
	process.env.HOME || "/home/toxic",
	".local/share/kappa",
	"kappa-main.db",
);

interface KappaSessionRow {
	id: string;
	title: string | null;
	directory: string | null;
	parent_id: string | null;
}

interface KappaMessageRow {
	data: string;
}

/** Read kappa sessions and map them onto the tau audit Session shape. */
export function loadKappaSessions(dbPath: string = KAPPA_DB): Session[] {
	if (!existsSync(dbPath)) return [];
	let db: Database;
	try {
		db = new Database(dbPath, { readonly: true });
	} catch {
		return [];
	}
	try {
		const sessions = db
			.query(
				"SELECT id, title, directory, parent_id FROM session ORDER BY time_created DESC",
			)
			.all() as unknown as KappaSessionRow[];

		return sessions.map((row) => {
			const messages = db
				.query(
					"SELECT data FROM message WHERE session_id = ? ORDER BY time_created ASC",
				)
				.all(row.id) as unknown as KappaMessageRow[];

			const roles = new Map<string, number>();
			let model = "";
			let finishStop = 0;
			let _toolCalls = 0;
			let _costTotal = 0;
			const parsed: Array<Record<string, unknown>> = [];
			for (const m of messages) {
				let d: Record<string, unknown>;
				try {
					d = JSON.parse(m.data) as Record<string, unknown>;
				} catch {
					continue;
				}
				const role = typeof d.role === "string" ? d.role : "unknown";
				roles.set(role, (roles.get(role) || 0) + 1);
				if (!model && typeof d.modelID === "string")
					model = `${String(d.providerID ?? "")}/${d.modelID}`;
				if (d.finish === "stop") finishStop += 1;
				if (d.role === "assistant" && Array.isArray(d.tools))
					_toolCalls += (d.tools as unknown[]).length;
				const cost = d.cost as { total?: number } | undefined;
				if (cost && typeof cost.total === "number") _costTotal += cost.total;
				parsed.push(d);
			}
			// Pattern pass over kappa rows: synthesize SessionEvents and run the
			// shared tau detectors so kappa sessions carry pattern analysis too.
			const events: SessionEvent[] = [];
			let lastTool = "";
			for (const d of parsed) {
				const role = typeof d.role === "string" ? d.role : "unknown";
				if (role === "assistant" && Array.isArray(d.tools)) {
					const first = (d.tools as Array<Record<string, unknown>>)[0];
					lastTool =
						typeof first?.name === "string"
							? first.name
							: String(first?.toolName ?? "");
					events.push({
						type: "message",
						message: {
							role: "toolCall",
							toolName: lastTool || undefined,
							toolCallId: String(first?.id ?? ""),
						},
					});
					if (lastTool === "todo") {
						events.push({
							type: "todo",
							data: {
								toolName: "todo",
								args: (first?.args ?? first?.input) as
									| Record<string, unknown>
									| undefined,
							},
						});
					}
				} else {
					const isErr =
						d.isError === true ||
						/traceback|error TS|cannot read file|rule_violation|exit code [1-9]|rc *= *[1-9]/i.test(
							String(d.content ?? ""),
						);
					events.push({
						type: "message",
						message: {
							role: "toolResult",
							toolName: lastTool || undefined,
							isError: isErr,
							content: String(d.content ?? ""),
						},
					});
				}
			}
			const patterns = runAllPatterns(events, {
				file: `kappa:${row.id}`,
				model,
				cwd: row.directory ?? "",
				title: row.title ?? "",
			});
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

			const isSubagent =
				typeof row.parent_id === "string" && row.parent_id.length > 0;
			const title = row.title ?? "";
			// Completed signal: >=1 assistant turn with finish=stop (kappa's analog
			// of a finished response). Subagents complete with their parent's flow.
			const completed = finishStop > 0;
			const anomalyScore =
				(messages.length === 0 ? 10 : 0) +
				(completed ? 0 : 8) +
				(isSubagent ? 0 : 0);

			return {
				file: `kappa:${row.id}${isSubagent ? " (subagent)" : ""}`,
				events: messages.length,
				types: roles,
				title,
				model,
				cwd: row.directory ?? "",
				intent: inferKappaIntent(title, isSubagent),
				completed,
				anomalyScore,
				patterns,
				phantomTodoCount,
			} satisfies Session;
		});
	} finally {
		db.close();
	}
}

/** Intent inference over kappa titles — kappa-flavored additions on top of the shared heuristics. */
export function inferKappaIntent(title: string, isSubagent: boolean): string {
	const t = title.toLowerCase();
	if (isSubagent) return "Kappa subagent work";
	if (t.includes("config") && (t.includes("oddity") || t.includes("fix")))
		return "Kappa config investigation";
	if (t.includes("fingerprint")) return "Fingerprint transport work";
	if (t.includes("gateway")) return "Kappa gateway work";
	if (t.includes("model")) return "Kappa model setup";
	return "General kappa work";
}
