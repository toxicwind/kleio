// tau-session-audit — Pattern Registry

import { adhdStreamCollapseDetector } from "./adhd-stream-collapse";
import { depthSinkDetector } from "./depth-sink";
import { evalLoopDetector } from "./eval-loop";
import { ghostPathDetector } from "./ghost-path";
import { modelChurnDetector } from "./model-churn";
import { repeatedLoopDetector } from "./repeated-loop";
import { thinkingLeakDetector } from "./thinking-leak";
import { uiPokeDetector } from "./ui-poke";
import { todoPhantomCompletionDetector } from "./todo-phantom-completion";
import type {
	PatternDetector,
	PatternMatch,
	SessionContext,
	SessionEvent,
} from "./types";

export { adhdStreamCollapseDetector } from "./adhd-stream-collapse";
export { depthSinkDetector, pathDepth } from "./depth-sink";
export { evalLoopDetector, normalizeIntent } from "./eval-loop";
export { ghostPathDetector } from "./ghost-path";
export { modelChurnDetector } from "./model-churn";
export { repeatedLoopDetector } from "./repeated-loop";
export { thinkingLeakDetector } from "./thinking-leak";
export { uiPokeDetector } from "./ui-poke";
export { todoPhantomCompletionDetector } from "./todo-phantom-completion";
export * from "./types";

const ALL_DETECTORS: PatternDetector[] = [
	todoPhantomCompletionDetector,
	thinkingLeakDetector,
	repeatedLoopDetector,
	modelChurnDetector,
	adhdStreamCollapseDetector,
	depthSinkDetector,
	evalLoopDetector,
	ghostPathDetector,
	uiPokeDetector,
];

export function getAllDetectors(): PatternDetector[] {
	return ALL_DETECTORS;
}

export function runAllPatterns(
	events: SessionEvent[],
	context?: SessionContext,
): PatternMatch[] {
	const allMatches: PatternMatch[] = [];
	for (const detector of ALL_DETECTORS) {
		try {
			const matches = detector.detect(events, context);
			allMatches.push(...matches);
		} catch {
			// Continue running remaining detectors if one fails
		}
	}
	return allMatches;
}
