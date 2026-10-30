// kleio pattern: workspace depth-gradient collapse
//
// First-class port of the folder-depthed-analysis methodology
// (managed skill, 2026-10-30): a session's cwd tree is audited by DEPTH
// GRADIENT — deep tails (vendored deps, build tombstones), hidden sweep
// (secrets, coordinator state, editor droppings), and poison-pattern classes
// (orphaned refs, GC-less spew, split-brain pointers). The session-events
// analog: a working session that keeps digging deeper and deeper into the
// same subtree signals an agent stuck inside a vendored/build black hole —
// the classic "reading node_modules" death spiral.
import type { PatternDetector, PatternMatch, SessionEvent } from "../patterns/types";

const DEPTH_SINK_THRESHOLD = 12;
const CONSECUTIVE_DEEP_SINKS = 6;

/** Derive a depth score from a path relative to the session cwd. */
export function pathDepth(cwd: string, target: string): number {
	if (!target.startsWith(cwd)) return 0;
	const rel = target.slice(cwd.length).replace(/^\/+/, "");
	if (rel === "") return 0;
	return rel.split("/").length;
}

function extractPaths(events: SessionEvent[]): Array<{ index: number; raw: string }> {
	const paths: Array<{ index: number; raw: string }> = [];
	events.forEach((event, index) => {
		const argsPath = (event.data?.args as { path?: string; file?: string; command?: string } | undefined) ?? {};
		const candidate = argsPath.path ?? argsPath.file ?? argsPath.command;
		if (typeof candidate === "string" && candidate.length > 0) paths.push({ index, raw: candidate });
	});
	return paths;
}

export const depthSinkDetector: PatternDetector = {
	id: "workspace-depth-sink",
	name: "Workspace depth sink",
	description:
		"Consecutive tool calls sinking deeper than the depth threshold into one subtree — the session analog of a 26-deep .next/standalone tail: the agent is almost certainly reading vendored/build output instead of source. Real-behavior anchor: kappa-docs/.next/standalone (26 dirs deep) was the deepest tail in the 2026-10-30 sudo hidden sweep of tau+kappa.",
	detect(events, context) {
		const matches: PatternMatch[] = [];
		const cwd = context?.cwd ?? "";
		let runStart: number | null = null;
		let runCount = 0;
		let runDepth = 0;

		const flush = (endIndex: number) => {
			if (runStart !== null && runCount >= CONSECUTIVE_DEEP_SINKS) {
				matches.push({
					patternId: "workspace-depth-sink",
					name: "Workspace depth sink",
					severity: "medium",
					description: `${runCount} consecutive tool calls deeper than ${DEPTH_SINK_THRESHOLD} levels below cwd — likely lost inside vendored/build output`,
					details: { eventIndex: endIndex, consecutiveCount: runCount, intent: events[runStart]?.data?.intent },
				});
			}
			runStart = null;
			runCount = 0;
			runDepth = 0;
		};

		const paths = extractPaths(events);
		let cursor = 0;
		for (const { index, raw } of paths) {
			// Only absolute paths inside the cwd count toward the sink.
			if (!raw.startsWith("/")) continue;
			const depth = pathDepth(cwd, raw.split(" ")[0] ?? raw);
			if (depth > DEPTH_SINK_THRESHOLD) {
				if (runStart === null) runStart = cursor;
				runCount++;
				runDepth = Math.max(runDepth, depth);
			} else {
				flush(cursor);
			}
			cursor = index + 1;
		}
		flush(cursor);
		return matches;
	},
};
