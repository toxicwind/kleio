// tau-session-audit — Pattern Detection Types

export type PatternSeverity = "critical" | "high" | "medium" | "low";

export interface PatternMatch {
	patternId: string;
	name: string;
	severity: PatternSeverity;
	description: string;
	details: {
		eventIndex?: number;
		model?: string;
		intent?: string;
		messageSnippet?: string;
		todoSnippet?: string;
		consecutiveCount?: number;
		toolSequence?: string[];
		[key: string]: unknown;
	};
}

export interface SessionContext {
	file: string;
	model: string;
	cwd: string;
	title?: string;
}

export interface SessionEvent {
	type?: string;
	customType?: string;
	data?: {
		toolCallId?: string;
		toolName?: string;
		intent?: string;
		args?: Record<string, unknown>;
		startedAt?: string;
		[key: string]: unknown;
	};
	message?: {
		role?: string;
		toolName?: string;
		toolCallId?: string;
		isError?: boolean;
		content?: unknown;
		[key: string]: unknown;
	};
	model?: string;
	title?: string;
	cwd?: string;
	timestamp?: string;
	[key: string]: unknown;
}

export interface PatternDetector {
	id: string;
	name: string;
	description: string;
	detect(events: SessionEvent[], context?: SessionContext): PatternMatch[];
}
