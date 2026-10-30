// Pattern: Ghost Estate Path
// Detects tool calls that reference /home/toxic/pens/estate/* — the retired ghost
// checkout. The SSOT is /home/toxic/pens/estate (estate single-truth lease,
// anomaly #48). Anything rooted at /home/toxic/estate is a lease violation:
// edits there are silently lost because pitchfork loads pens/estate.

import type {
	PatternDetector,
	PatternMatch,
	SessionEvent,
} from "./types";

const GHOST_RE = /\/home\/toxic\/estate(?!\/pens)/;

function eventText(e: SessionEvent): string {
	const parts: string[] = [];
	const data = e.data;
	if (data) {
		if (typeof data.intent === "string") parts.push(data.intent);
		if (data.args && typeof data.args === "object") {
			parts.push(JSON.stringify(data.args));
		}
	}
	const content = e.message?.content;
	if (typeof content === "string") parts.push(content);
	else if (Array.isArray(content)) {
		for (const item of content) {
			if (item && typeof item === "object") {
				const r = item as Record<string, unknown>;
				if (r.type === "text" && typeof r.text === "string") parts.push(r.text);
			}
		}
	}
	return parts.join(" ");
}

export const ghostPathDetector: PatternDetector = {
	id: "ghost-path",
	name: "Ghost Estate Path Reference",
	description:
		"Detects tool calls referencing /home/toxic/pens/estate/* (the retired ghost checkout) instead of the /home/toxic/pens/estate SSOT.",

	detect(events: SessionEvent[], context?: SessionContext): PatternMatch[] {
		const matches: PatternMatch[] = [];
		const model = context?.model || "unknown";

		for (let i = 0; i < events.length; i++) {
			const e = events[i]!;
			if (e.type !== "custom" || e.customType !== "tool_execution_start") continue;

			const text = eventText(e);
			const m = text.match(GHOST_RE);
			if (m) {
				matches.push({
					patternId: "GHOST_ESTATE_PATH",
					name: "Ghost /home/toxic/estate Path (lease violation)",
					severity: "high",
					description: `Model ${model} targeted the retired ghost checkout at /home/toxic/estate. Edits there are silently lost (pitchfork loads pens/estate). Repoint to /home/toxic/pens/estate.`,
					details: {
						eventIndex: i,
						model,
						toolName: e.data?.toolName,
						pathSnippet: text.slice(0, 250),
					},
				});
			}
		}
		return matches;
	},
};
