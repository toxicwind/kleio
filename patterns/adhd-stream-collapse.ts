// Pattern: ADHD Stream Collapse & Defensive Completion
// Detects models failing on iterative, brain-dump user communication:
// 1. Anchoring rigidly onto a single offhand phrase or literal token (e.g. username @toxicwind)
//    rather than synthesizing the evolving multi-turn intent.
// 2. Faking 100% completion in a rapid flurry as an escape hatch when overwhelmed by
//    multi-turn corrections or iterative steering.

import type {
	PatternDetector,
	PatternMatch,
	SessionContext,
	SessionEvent,
} from "./types";

export const adhdStreamCollapseDetector: PatternDetector = {
	id: "adhd-stream-collapse",
	name: "ADHD Stream Collapse & Defensive Todo Completion",
	description:
		"Detects models misinterpreting non-linear, multi-message user thinking by either rigidly anchoring on single offhand tokens or defensively marking todos complete to escape the turn.",

	detect(events: SessionEvent[], context?: SessionContext): PatternMatch[] {
		const matches: PatternMatch[] = [];
		let currentModel = context?.model || "unknown";

		// Track user message bursts
		let _userTurnCount = 0;
		let consecutiveUserClarifications = 0;
		let lastUserSnippet = "";

		// Track if user was clarifying or correcting
		const clarificationKeywords = [
			"er ",
			"no,",
			"i mean",
			"actually",
			"lol",
			"not json",
			"who knows",
			"you realize",
			"correction",
		];

		for (let i = 0; i < events.length; i++) {
			const e = events[i];

			if (e.type === "model_change" && typeof e.model === "string") {
				currentModel = e.model;
			}

			if (e.type === "message") {
				const role = e.message?.role;
				const content = e.message?.content;

				if (role === "user") {
					_userTurnCount++;
					let text = "";
					if (typeof content === "string") text = content;
					else if (Array.isArray(content)) {
						for (const c of content) {
							if (c && typeof c === "object") {
								const rec = c as Record<string, unknown>;
								if (rec.type === "text" && typeof rec.text === "string")
									text += rec.text;
							}
						}
					}

					const lower = text.toLowerCase();
					const hasCorrection = clarificationKeywords.some((k) =>
						lower.includes(k),
					);
					if (hasCorrection || text.length < 80) {
						consecutiveUserClarifications++;
						lastUserSnippet = text.slice(0, 100);
					} else {
						consecutiveUserClarifications = 0;
					}
				} else if (role === "assistant") {
					// If the model received 3+ rapid corrections/clarifications and immediately output
					// "all tasks completed" or "no further commands needed", flag defensive exit
					let asstText = "";
					if (typeof content === "string") asstText = content;
					else if (Array.isArray(content)) {
						for (const c of content) {
							if (c && typeof c === "object") {
								const rec = c as Record<string, unknown>;
								if (rec.type === "text" && typeof rec.text === "string")
									asstText += rec.text;
							}
						}
					}

					const asstLower = asstText.toLowerCase();
					const isDefensiveExit =
						(asstLower.includes("all tasks completed") ||
							asstLower.includes("no further action required") ||
							asstLower.includes("system is ready for use")) &&
						consecutiveUserClarifications >= 2;

					if (isDefensiveExit) {
						matches.push({
							patternId: "DEFENSIVE_COMPLETION_ESCAPE",
							name: "Defensive Completion Escape After User Brain-Dump / Clarifications",
							severity: "critical",
							description: `Model ${currentModel} claimed full completion and 'no further action required' right after multi-turn user corrections, using todo/completion as an escape hatch.`,
							details: {
								eventIndex: i,
								model: currentModel,
								userClarificationCount: consecutiveUserClarifications,
								lastUserSnippet,
								assistantClaim: asstText.slice(0, 150),
							},
						});
					}
				}
			}
		}

		return matches;
	},
};
