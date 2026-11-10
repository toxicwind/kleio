// providers/kilo.ts — kilo sessions (SQLite), driven by schemas/kilo.toml.
//
// kilo's schema is a near-twin of kappa's (same todo/event table shapes), so
// this provider mirrors kappa.ts with the kilo db path + kilo intent labels.
// Added live 2026-11-04 (kilo session audit via live shim mutation).

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { runAllPatterns } from "../patterns/index";
import type { SessionEvent } from "../patterns/types";
import { expandHome, readProviderSchema } from "./schema";
import type { PlanProgress, ProviderSpec, Session } from "./types";

interface Row {
	[k: string]: unknown;
}

function col(row: Row, k: string): unknown {
	return row[k];
}

/** Native plan progress from the kilo `todo` table. */
function planFromTodos(
	rows: Row[],
	s: { todos?: Record<string, string> },
): PlanProgress | undefined {
	if (!s.todos) return undefined;
	const statusCol = s.todos.status || "status";
	let done = 0,
		open = 0;
	for (const r of rows) {
		const st = String(col(r, statusCol) ?? "");
		if (["completed", "done"].includes(st)) done += 1;
		else open += 1;
	}
	const total = done + open;
	return {
		open,
		done,
		blocked: 0,
		total,
		pct: total === 0 ? 0 : Math.round((done / total) * 100),
		todoEvents: rows.length,
		snippet: "",
	};
}

/** Synthesize SessionEvents from the kilo event stream (message.*). */
function eventsFromStream(
	stream: Row[],
	s: { events?: Record<string, string> },
): SessionEvent[] {
	const events: SessionEvent[] = [];
	const typeCol = s.events?.type || "type";
	const dataCol = s.events?.data || "data";
	const lastToolBySession = new Map<string, string>();
	for (const r of stream) {
		const type = String(col(r, typeCol) ?? "");
		let data: Record<string, unknown>;
		try {
			data = JSON.parse(String(col(r, dataCol) ?? ""));
		} catch {
			continue;
		}
		const info = (data.info ?? data) as Record<string, unknown>;
		const role = typeof info.role === "string" ? info.role : "";
		const agg = String(col(r, s.events?.aggregate || "aggregate_id") ?? "");
		if (type.startsWith("message.")) {
			if (role === "assistant") {
				const tools = Array.isArray(info.tools)
					? (info.tools as Array<Record<string, unknown>>)
					: [];
				const toolName = tools[0]
					? String(tools[0].name ?? tools[0].toolName ?? "")
					: "";
				if (toolName) {
					lastToolBySession.set(agg, toolName);
					events.push({
						type: "message",
						message: {
							role: "toolCall",
							toolName,
							toolCallId: String(tools[0].id ?? ""),
						},
					});
				} else {
					events.push({
						type: "message",
						message: { role: "assistant", toolName: "" },
					});
				}
			} else if (role === "user") {
				const prev = lastToolBySession.get(agg) || "";
				events.push({
					type: "message",
					message: {
						role: "toolResult",
						toolName: prev || undefined,
						isError: false,
						content: "",
					},
				});
				lastToolBySession.set(agg, "");
			}
		}
	}
	return events;
}

export function loadKiloSessions(dbPath?: string): Session[] {
	const schema = readProviderSchema("kilo");
	const src = expandHome(dbPath ?? schema.source.db) ?? "";
	if (!existsSync(src)) return [];
	let db: Database;
	try {
		db = new Database(src, { readonly: true });
	} catch {
		return [];
	}
	try {
		const S = schema.sessions ?? {};
		const M = schema.messages ?? {};
		const rows = db
			.query(
				`SELECT ${S.id}, ${S.title}, ${S.directory}, ${S.parent_id} FROM ${schema.sessions?.table ?? "session"} ORDER BY time_created DESC`,
			)
			.all() as unknown as Row[];
		return rows.map((row) => {
			const sid = String(col(row, S.id ?? "id") ?? "");
			const messages = db
				.query(
					`SELECT ${M.data} FROM ${schema.messages?.table ?? "message"} WHERE ${M.session_fk ?? "session_id"} = ? ORDER BY time_created ASC`,
				)
				.all(sid) as unknown as Row[];
			const todos = schema.todos
				? (db
						.query(
							`SELECT ${schema.todos.status}, ${schema.todos.content} FROM ${schema.todos.table} WHERE ${schema.todos.session_fk} = ? ORDER BY ${schema.todos.position ?? "position"}`,
						)
						.all(sid) as unknown as Row[])
				: [];
			const stream = schema.events
				? (db
						.query(
							`SELECT ${schema.events.type}, ${schema.events.data}, ${schema.events.aggregate} FROM ${schema.events.table} WHERE ${schema.events.aggregate} = ? ORDER BY ${schema.events.seq ?? "seq"}`,
						)
						.all(sid) as unknown as Row[])
				: [];

			const roles = new Map<string, number>();
			let model = "";
			let finishStop = 0;
			for (const m of messages) {
				try {
					const d = JSON.parse(
						String(col(m, M.data ?? "data") ?? ""),
					) as Record<string, unknown>;
					const role = typeof d.role === "string" ? d.role : "unknown";
					roles.set(role, (roles.get(role) || 0) + 1);
					if (!model) {
						// kilo stores model as a plain string on the session row;
						// message data may carry providerID/modelID like kappa.
						const mo = (d.model ?? d) as Record<string, unknown>;
						if (typeof mo.modelID === "string")
							model = `${String(mo.providerID ?? "")}/${mo.modelID}`;
						else if (typeof d.modelID === "string")
							model = `${String(d.providerID ?? "")}/${d.modelID}`;
					}
					if (d.finish === "stop") finishStop += 1;
				} catch {
					/* skip */
				}
			}
			const events = eventsFromStream(stream, { events: schema.events });
			const isSubagent =
				typeof col(row, S.parent_id ?? "parent_id") === "string" &&
				String(col(row, S.parent_id ?? "parent_id")).length > 0;
			const title = String(col(row, S.title ?? "title") ?? "");
			const patterns = runAllPatterns(events, {
				file: `kilo:${sid}`,
				model,
				cwd: String(col(row, S.directory ?? "directory") ?? ""),
				title,
			});
			let phantomTodoCount = 0;
			for (const p of patterns) {
				if (
					p.patternId === "CONSECUTIVE_TODO_FLURRY" &&
					typeof p.details.consecutiveCount === "number"
				)
					phantomTodoCount += p.details.consecutiveCount;
				else if (p.patternId === "MESSAGE_NO_TOOLS_THEN_TODO_DONE")
					phantomTodoCount += 1;
			}
			const plan = schema.todos
				? planFromTodos(todos, { todos: schema.todos })
				: undefined;
			// kilo keeps model on the session row itself
			const sessionModel = typeof col(row, "model") === "string" ? String(col(row, "model") ?? "") : "";
			return {
				file: `kilo:${sid}${isSubagent ? " (subagent)" : ""}`,
				events: messages.length,
				types: roles,
				title,
				model: model || sessionModel,
				cwd: String(col(row, S.directory ?? "directory") ?? ""),
				intent: inferKiloIntent(title, isSubagent),
				completed: finishStop > 0,
				anomalyScore:
					(messages.length === 0 ? 10 : 0) + (finishStop > 0 ? 0 : 8),
				patterns,
				phantomTodoCount,
				plan,
			} satisfies Session;
		});
	} finally {
		db.close();
	}
}

export function inferKiloIntent(title: string, isSubagent: boolean): string {
	const t = title.toLowerCase();
	if (isSubagent) return "Kilo subagent work";
	if (t.includes("audit")) return "Audit / verification";
	if (t.includes("config") && (t.includes("oddity") || t.includes("fix")))
		return "Kilo config investigation";
	if (t.includes("model")) return "Kilo model setup";
	return "General kilo work";
}

export const kiloProvider: ProviderSpec = {
	name: "kilo",
	label: "kilo SQLite",
	load: () => loadKiloSessions(),
};
