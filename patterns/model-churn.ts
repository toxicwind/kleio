// Pattern: Model Churn & Rotation Thrashing
// Detects sessions where 4 or more models were rotated due to agent stalls, failures, or loops.

import type {
	PatternDetector,
	PatternMatch,
	SessionContext,
	SessionEvent,
} from "./types";

export const modelChurnDetector: PatternDetector = {
	id: "model-churn",
	name: "Model Churn & Rotation Thrashing",
	description:
		"Detects sessions with excessive model swapping (4+ models), signaling agent unreliability, stalling, or hallucination loops.",

	detect(events: SessionEvent[], _context?: SessionContext): PatternMatch[] {
		const matches: PatternMatch[] = [];
		const modelsSeen: string[] = [];

		for (let i = 0; i < events.length; i++) {
			const e = events[i];
			if (
				e.type === "model_change" &&
				typeof e.model === "string" &&
				e.model.trim()
			) {
				if (!modelsSeen.includes(e.model)) {
					modelsSeen.push(e.model);
				}
			}
		}

		if (modelsSeen.length >= 4) {
			matches.push({
				patternId: "MODEL_ROTATION_CHURN",
				name: "High Model Churn Session",
				severity: modelsSeen.length >= 6 ? "critical" : "medium",
				description: `Session rotated through ${modelsSeen.length} models: ${modelsSeen.slice(0, 5).join(", ")}${modelsSeen.length > 5 ? "..." : ""}`,
				details: {
					totalModels: modelsSeen.length,
					models: modelsSeen,
				},
			});
		}

		return matches;
	},
};
