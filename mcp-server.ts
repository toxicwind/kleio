// kleio MCP server — the session historian as MCP tools.
// stdio JSON-RPC with dual framing (Content-Length or newline-delimited JSON)
// per mcp-dropin-guide R-101..R-103. Every tool is read-only and wraps the
// kleio audit engine (providers + analysis + report).
//
//   kleio_plan       merged plan progress across tau + kappa
//   kleio_failures   repeated failure loops by error snippet
//   kleio_report     full GitHub-flavored markdown report (written to reports/)
//   kleio_search     regex search across session content
//   kleio_health     engine + sources status

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { failureLoops, planSummary, renderFailures } from "./helper/analysis";
import { generateMarkdownReport } from "./helper/report";
import { loadAllSessions } from "./providers/registry";

const PRODUCT_DIR = join(dirname(fileURLToPath(import.meta.url)));
const REPORTS_DIR = join(PRODUCT_DIR, "reports");

// ── JSON-RPC plumbing ────────────────────────────────────────────────────────

function respond(id: unknown, result: unknown, ok = true): void {
	const body = ok
		? JSON.stringify({ jsonrpc: "2.0", id, result })
		: JSON.stringify({ jsonrpc: "2.0", id, error: result });
	// Content-Length framing (MCP stdio default) + newline fallback.
	const framed = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}\n`;
	process.stdout.write(framed);
}

function fail(id: unknown, code: number, message: string): void {
	respond(id, { code, message }, false);
}

// ── Tool handlers ────────────────────────────────────────────────────────────

async function sessions(): Promise<ReturnType<typeof loadAllSessions>> {
	const all = await loadAllSessions();
	return all;
}

function toolPlan(sessions: Awaited<ReturnType<typeof loadAllSessions>>) {
	const eventsByFile = new Map<string, never[]>();
	// tau raw events are re-read by the CLI; the MCP surface reports plans only.
	for (const s of sessions) {
		if (s.plan) eventsByFile.set(s.file, []);
	}
	const ps = planSummary(sessions, eventsByFile);
	return {
		trackingSessions: ps.trackingSessions,
		totals: ps.totals,
		top: ps.tracked.slice(0, 15).map((r) => ({ file: r.file, plan: r.plan })),
	};
}

function toolFailures(sessions: Awaited<ReturnType<typeof loadAllSessions>>) {
	const loops = failureLoops(sessions);
	return {
		total: loops.length,
		repeatTotal: loops.reduce((a, l) => a + l.repeatTotal, 0),
		top: loops.slice(0, 15),
		text: renderFailures(loops),
	};
}

function toolReport(
	sessions: Awaited<ReturnType<typeof loadAllSessions>>,
	out?: string,
) {
	const md = generateMarkdownReport(sessions);
	const target =
		out || join(REPORTS_DIR, `${new Date().toISOString().slice(0, 10)}.md`);
	try {
		writeFileSync(target, md, "utf-8");
	} catch (e) {
		return {
			ok: false,
			written: target,
			error: String((e as Error).message).slice(0, 140),
		};
	}
	return { ok: true, written: target, chars: md.length };
}

function toolSearch(
	sessions: Awaited<ReturnType<typeof loadAllSessions>>,
	pattern: string,
	limit = 10,
) {
	let re: RegExp;
	try {
		re = new RegExp(pattern, "i");
	} catch (e) {
		return { ok: false, error: String((e as Error).message).slice(0, 140) };
	}
	const hits = sessions
		.filter(
			(s) =>
				re.test(s.title) ||
				re.test(s.intent) ||
				re.test(s.model) ||
				re.test(s.file),
		)
		.slice(0, limit)
		.map((s) => ({
			file: s.file,
			title: s.title,
			intent: s.intent,
			completed: s.completed,
		}));
	return {
		ok: true,
		total: sessions.filter(
			(s) =>
				re.test(s.title) ||
				re.test(s.intent) ||
				re.test(s.model) ||
				re.test(s.file),
		).length,
		hits,
	};
}

function toolHealth(sessions: Awaited<ReturnType<typeof loadAllSessions>>) {
	const bySource = new Map<string, number>();
	for (const s of sessions)
		bySource.set(s.source, (bySource.get(s.source) || 0) + 1);
	return {
		ok: true,
		engines: [...bySource.entries()].map(([k, v]) => ({
			source: k,
			sessions: v,
		})),
		totalSessions: sessions.length,
		productDir: PRODUCT_DIR,
		reportsDir: REPORTS_DIR,
	};
}

const TOOLS: Array<{
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	run: (
		a: Record<string, unknown>,
		sess: Awaited<ReturnType<typeof loadAllSessions>>,
	) => unknown;
}> = [
	{
		name: "kleio_plan",
		description:
			"Merged session plan progress across tau + kappa (done/open/blocked per tracking session). Read-only.",
		inputSchema: { type: "object", properties: {}, required: [] },
		run: (_, s) => toolPlan(s),
	},
	{
		name: "kleio_failures",
		description:
			"Repeated failure loops across all sessions, grouped by error snippet. Read-only.",
		inputSchema: { type: "object", properties: {}, required: [] },
		run: (_, s) => toolFailures(s),
	},
	{
		name: "kleio_report",
		description:
			"Generate + save the full session-audit GitHub markdown report to kleio/reports/. Read-only.",
		inputSchema: {
			type: "object",
			properties: {
				out: { type: "string", description: "Optional explicit output path." },
			},
			required: [],
		},
		run: (a, s) => toolReport(s, a.out as string | undefined),
	},
	{
		name: "kleio_search",
		description:
			"Regex search across session titles/intents/models/files. Read-only.",
		inputSchema: {
			type: "object",
			properties: {
				pattern: { type: "string", description: "Regex (case-insensitive)." },
				limit: { type: "number", description: "Max hits (default 10)." },
			},
			required: ["pattern"],
		},
		run: (a, s) => toolSearch(s, String(a.pattern), Number(a.limit ?? 10)),
	},
	{
		name: "kleio_health",
		description:
			"Engine + source status: sessions per provider, product/reports dirs. Read-only.",
		inputSchema: { type: "object", properties: {}, required: [] },
		run: (_, s) => toolHealth(s),
	},
];

	// ── Request loop (Content-Length or newline-delimited JSON) ─────────────────

	function handleRequest(line: string): void {
		let req: Record<string, unknown>;
		try {
			req = JSON.parse(line);
		} catch {
			return;
		}
		const id = req.id as unknown;
		const method = typeof req.method === "string" ? req.method : "";

		if (method === "initialize") {
			respond(id, {
				protocolVersion:
					(req.params &&
						typeof req.params === "object" &&
						(req.params as { protocolVersion?: string }).protocolVersion) ||
					"2024-11-05",
				capabilities: { tools: { listChanged: false } },
				serverInfo: {
					name: "kleio",
					title: "Kleio — session historian",
					version: "0.1.0",
				},
			});
			return;
		}
		if (method === "notifications/initialized" || method === "initialized") {
			return;
		}
		if (method === "ping") {
			respond(id, {});
			return;
		}
		if (method === "tools/list") {
			respond(id, {
				tools: TOOLS.map((t) => ({
					name: t.name,
					description: t.description,
					inputSchema: t.inputSchema,
				})),
			});
			return;
		}

		if (method === "tools/call") {
			const params = (req.params ?? {}) as {
				name?: string;
				arguments?: Record<string, unknown>;
			};
			const tool = TOOLS.find((t) => t.name === params.name);
			if (!tool) {
				fail(id, -32602, `unknown tool: ${params.name}`);
				return;
			}
			const p = sessions().then((s) => tool.run(params.arguments ?? {}, s));
			p.then((result) =>
				respond(id, {
					content: [{ type: "text", text: JSON.stringify(result, null, 1) }],
				}),
			).catch((e) =>
				fail(id, -32603, String((e as Error).message).slice(0, 200)),
			);
			return;
		}

		fail(id, -32601, `method not found: ${method}`);
	}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
	buf += chunk;
	// newline-delimited frames
	let idx: number;
	for (;;) {
		idx = buf.indexOf("\n");
		if (idx < 0) break;
		const line = buf.slice(0, idx).trim();
		buf = buf.slice(idx + 1);
		if (line.startsWith("{")) handleRequest(line);
	}
	// Content-Length frames
	const m = buf.match(/^Content-Length: (\d+)\r?\n\r?\n/);
	if (m) {
		const len = Number(m[1]);
		if (buf.length >= m[0].length + len) {
			const body = buf.slice(m[0].length, m[0].length + len);
			buf = "";
			handleRequest(body);
		}
	}
});
process.stdin.on("end", () => process.exit(0));
