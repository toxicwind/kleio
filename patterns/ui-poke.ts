// Pattern: UI Poke As Diagnosis
// Detects using a live device UI (Player.Open, GUI probes, Input.* on media
// boxes) when source-reading was available — the 2026-10-30 signature: 69
// picker/select rows while the addon's router.py sat readable on disk. Every
// UI poke can spawn dialogs on a shared living-room device; read the source
// instead when it exists.

import type {
	PatternDetector,
	PatternMatch,
	SessionEvent,
} from "./types";

const UI_POKE_INTENT_RE =
	/\b(player\.open|gui\.get|input\.select|input\.send|probe gui|window state|select source|press select|open player|picker|sources_results)\b/i;

const SOURCE_READ_TOOLS = new Set(["read", "grep", "glob", "find", "ffs"]);
const SOURCE_READ_INTENT_RE =
	/\b(read|grep|dispatch|router|source|impl|implementation|code)\b/i;

function intentOf(e: SessionEvent): string {
	return typeof e.data?.intent === "string" ? e.data.intent : "";
}

function toolOf(e: SessionEvent): string {
	return typeof e.data?.toolName === "string" ? e.data.toolName : "";
}

function isUiPoke(e: SessionEvent): boolean {
	return UI_POKE_INTENT_RE.test(intentOf(e));
}

function isSourceRead(e: SessionEvent): boolean {
	if (SOURCE_READ_TOOLS.has(toolOf(e))) return true;
	return SOURCE_READ_INTENT_RE.test(intentOf(e));
}

export const uiPokeDetector: PatternDetector = {
	id: "ui-poke",
	name: "UI Poke As Diagnosis",
	description:
		"Detects 3+ live-device UI probes (player/GUI/Input ops) in a session where source-reading tools were already in use — diagnose from code first, poke the device last.",

	detect(events: SessionEvent[], context?: SessionContext): PatternMatch[] {
		const matches: PatternMatch[] = [];
		const model = context?.model || "unknown";

		const sourceReadSeen = events.some(isSourceRead);
		if (!sourceReadSeen) return matches;

		let count = 0;
		let firstIndex = -1;
		let lastIntent = "";

		const flush = (endIndex: number) => {
			if (count >= 3) {
				matches.push({
					patternId: "UI_POKE_AS_DIAGNOSIS",
					name: "UI Poke As Diagnosis (device poked while source was readable)",
					severity: "high",
					description: `Model ${model} probed the live device UI ${count} times while source-reading tools were available. Read the dispatch/source first; UI pokes spawn dialogs on shared devices.`,
					details: {
						eventIndex: firstIndex,
						consecutiveCount: count,
						model,
						lastIntent,
					},
				});
			}
			count = 0;
			firstIndex = -1;
		};

		for (let i = 0; i < events.length; i++) {
			const e = events[i]!;
			if (e.type !== "custom" || e.customType !== "tool_execution_start") continue;

			if (isUiPoke(e)) {
				if (count === 0) firstIndex = i;
				count++;
				lastIntent = intentOf(e);
			} else if (isSourceRead(e)) {
				// A source read between pokes means the model IS diagnosing from
				// code — only flag runs of pure UI poking. Reset but remember.
				flush(i);
			}
		}
		flush(events.length);

		return matches;
	},
};
