// Pattern: Thinking Leak & Unexecuted Syntax Hallucination
// Detects models outputting raw scratchpads, pseudo-tool syntax (e.g. SM:FIND, SM:EDIT),
// or unexecuted shell/code blocks directly into user chat instead of invoking real tools.

import type {
	PatternDetector,
	PatternMatch,
	SessionContext,
	SessionEvent,
} from "./types";

export const thinkingLeakDetector: PatternDetector = {
	id: "thinking-leak",
	name: "Thinking Leak & Pseudo-Tool Syntax in User Chat",
	description:
		"Detects models outputting internal reasoning, unclosed thinking tags, or raw edit instructions (SM:FIND, <system-action>) into user-visible chat.",

	detect(events: SessionEvent[], context?: SessionContext): PatternMatch[] {
		const matches: PatternMatch[] = [];
		let currentModel = context?.model || "unknown";

		for (let i = 0; i < events.length; i++) {
			const e = events[i];

			if (e.type === "model_change" && typeof e.model === "string") {
				currentModel = e.model;
			}

			if (e.type === "message" && e.message?.role === "assistant") {
				let text = "";
				const content = e.message.content;
				if (typeof content === "string") {
					text = content;
				} else if (Array.isArray(content)) {
					for (const item of content) {
						if (item && typeof item === "object") {
							const record = item as Record<string, unknown>;
							if (record.type === "text" && typeof record.text === "string") {
								text += record.text;
							}
						}
					}
				}

				if (text.length === 0) continue;

				const hasSmSyntax =
					text.includes("SM:FIND") ||
					text.includes("SM:EDIT") ||
					text.includes("SM:AFTER");
				const hasUnclosedThinking =
					text.includes("</thinking>") || text.includes("<thinking>");
				const hasSystemAction = text.includes("<system-action>");

				if (hasSmSyntax || hasUnclosedThinking || hasSystemAction) {
					matches.push({
						patternId: "THINKING_LEAK_SYNTAX",
						name: "Unexecuted Scratchpad or Pseudo-Tool Syntax in Chat",
						severity: "high",
						description: `Model ${currentModel} leaked internal thought or pseudo-tool commands directly into conversation.`,
						details: {
							eventIndex: i,
							model: currentModel,
							hasSmSyntax,
							hasUnclosedThinking,
							hasSystemAction,
							snippet: text.slice(0, 200),
						},
					});
				}
			}
		}

		return matches;
	},
};
