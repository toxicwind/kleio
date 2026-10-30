// Pattern: Eval Loop Flailing
// Detects repeated same-intent eval calls with no result-bearing event between
// them — the 2026-10-30 CoreELEC signature: 52 "Eval cell aborted" + 9 kernel
// deaths with 862 tool calls and ZERO paired end-events. Same action retried
// with paraphrased intents (the loop detector never fired because intents
// varied while the action was identical).

import type {
	PatternDetector,
	PatternMatch,
	SessionEvent,
} from "./types";

const ABORT_MARKERS = [
	"eval cell aborted",
	"kernel died",
	"kernel shutdown",
	"kernel was killed",
	"kernel interrupted",
];

/** Normalize an intent: lowercase, strip filler, collapse whitespace. */
export function normalizeIntent(intent: string): string {
	return intent
		.toLowerCase()
		.replace(/^(checking|reading|finding|listing|locating|probing|looking for|searching)\s+/i, "")
		.replace(/\b(the|a|an|of|for|in|on|local|current)\b/g, " ")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

function resultContent(e: SessionEvent): string {
	const c = e.message?.content;
	if (typeof c === "string") return c;
	if (Array.isArray(c)) {
		let out = "";
		for (const item of c) {
			if (item && typeof item === "object") {
				const r = item as Record<string, unknown>;
				if (r.type === "text" && typeof r.text === "string") out += r.text;
			}
		}
		return out;
	}
	return "";
}

function isAbortedResult(e: SessionEvent): boolean {
	const text = resultContent(e).toLowerCase();
	return ABORT_MARKERS.some((m) => text.includes(m));
}

export const evalLoopDetector: PatternDetector = {
	id: "eval-loop",
	name: "Eval Loop Flailing",
	description:
		"Detects 3+ consecutive same-action eval calls whose results are aborts/kernel deaths — retries with paraphrased intents and no intervening progress.",

	detect(events: SessionEvent[], context?: SessionContext): PatternMatch[] {
		const matches: PatternMatch[] = [];
		const model = context?.model || "unknown";

		let run: Array<{ index: number; norm: string }> = [];
		let kernelDeaths = 0;

		const flush = (endIndex: number) => {
			if (run.length >= 3) {
				matches.push({
					patternId: "EVAL_LOOP_FLAILING",
					name: "Eval Loop Flailing (repeated aborts, no progress)",
					severity: kernelDeaths > 0 ? "critical" : "high",
					description: `Model ${model} repeated the same eval action ${run.length} times; every result was an abort/kernel death. Switch strategy instead of retrying.`,
					details: {
						eventIndex: run[0]!.index,
						consecutiveCount: run.length,
						model,
						intents: run.slice(0, 10).map((r) => r.norm),
						kernelDeaths,
					},
				});
			}
			run = [];
			kernelDeaths = 0;
		};

		for (let i = 0; i < events.length; i++) {
			const e = events[i]!;

			if (e.type === "custom" && e.customType === "tool_execution_start") {
				const toolName = e.data?.toolName;
				if (toolName === "eval") {
					run.push({
						index: i,
						norm: normalizeIntent(String(e.data?.intent ?? "")),
					});
					continue;
				}
				// A different tool breaks the run — flush if long enough
				flush(i);
				continue;
			}

			if (e.type === "message" && e.message?.role === "toolResult") {
				if (isAbortedResult(e)) kernelDeaths++;
				// Result-bearing event (abort or success) breaks the same-intent run:
				// a fresh result means the loop was *retried with new information*,
				// which is diagnosis, not flailing. Only consecutive aborts chain.
				if (!isAbortedResult(e)) flush(i);
			}
		}
		flush(events.length);

		return matches;
	},
};
