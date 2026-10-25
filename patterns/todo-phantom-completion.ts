// Pattern: Todo Phantom Completion & Premature Declaration
// Detects models that plan tasks and then mark them done without performing the work,
// or send a narrative message with no tools followed immediately by marking a todo done.

import type {
	PatternDetector,
	PatternMatch,
	SessionContext,
	SessionEvent,
} from "./types";

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		let result = "";
		for (const item of content) {
			if (item && typeof item === "object") {
				const record = item as Record<string, unknown>;
				if (record.type === "text" && typeof record.text === "string") {
					result += record.text;
				}
			}
		}
		return result;
	}
	return "";
}

function extractThinking(content: unknown): string {
	if (Array.isArray(content)) {
		let result = "";
		for (const item of content) {
			if (item && typeof item === "object") {
				const record = item as Record<string, unknown>;
				if (record.type === "thinking" && typeof record.thinking === "string") {
					result += record.thinking;
				}
			}
		}
		return result;
	}
	return "";
}

function hasToolCallInContent(content: unknown): boolean {
	if (Array.isArray(content)) {
		for (const item of content) {
			if (item && typeof item === "object") {
				const record = item as Record<string, unknown>;
				if (record.type === "toolCall") {
					return true;
				}
			}
		}
	}
	return false;
}

function isTodoDone(intent: string, args?: Record<string, unknown>): boolean {
	const lower = intent.toLowerCase();
	if (
		lower.includes("done") ||
		lower.includes("complete") ||
		lower.includes("finish")
	) {
		return true;
	}
	if (args && typeof args === "object") {
		const op = typeof args.op === "string" ? args.op.toLowerCase() : "";
		if (op === "done" || op === "drop") return true;
	}
	return false;
}

export const todoPhantomCompletionDetector: PatternDetector = {
	id: "todo-phantom-completion",
	name: "Todo Phantom Completion & Rapid Done Flurry",
	description:
		"Detects plans where tasks are marked complete without real work, assistant messages with no tools immediately followed by marking todos done, or consecutive todo done flurries.",

	detect(events: SessionEvent[], context?: SessionContext): PatternMatch[] {
		const matches: PatternMatch[] = [];
		let currentModel = context?.model || "unknown";

		// Track consecutive todo calls
		let consecutiveTodoCount = 0;
		let consecutiveTodoStartIndex = -1;
		let consecutiveTodoIntents: string[] = [];

		// Track last tool result
		let lastToolResultWasError = false;
		let lastToolErrorSnippet = "";

		for (let i = 0; i < events.length; i++) {
			const e = events[i];

			if (e.type === "model_change" && typeof e.model === "string") {
				currentModel = e.model;
			}

			// Check tool results for errors
			if (e.type === "message" && e.message?.role === "toolResult") {
				const isError = Boolean(e.message.isError);
				const contentStr =
					extractText(e.message.content) || String(e.message.content || "");
				if (
					isError ||
					contentStr.includes("error TS") ||
					contentStr.includes("Command exited with code") ||
					contentStr.includes("Error:")
				) {
					lastToolResultWasError = true;
					lastToolErrorSnippet = contentStr.slice(0, 200);
				} else {
					lastToolResultWasError = false;
					lastToolErrorSnippet = "";
				}
			}

			// 1. Check: Assistant message with no tools, followed immediately by todo done
			if (e.type === "message" && e.message?.role === "assistant") {
				const content = e.message.content;
				const hasTools = hasToolCallInContent(content);
				const text = extractText(content).trim();
				const thinking = extractThinking(content).trim();

				// If the assistant emitted text or thinking without executing execution tools
				if (!hasTools && (text.length > 0 || thinking.length > 0)) {
					// Look ahead to next 1-3 events for a todo completion tool call
					for (let j = i + 1; j < Math.min(i + 4, events.length); j++) {
						const nextEvent = events[j];
						if (
							nextEvent.type === "custom" &&
							nextEvent.customType === "tool_execution_start"
						) {
							const toolData = nextEvent.data;
							if (toolData?.toolName === "todo") {
								const intent =
									typeof toolData.intent === "string" ? toolData.intent : "";
								const args = toolData.args;

								if (isTodoDone(intent, args)) {
									matches.push({
										patternId: "MESSAGE_NO_TOOLS_THEN_TODO_DONE",
										name: "Message with No Execution Tools Followed by Todo Done",
										severity: "critical",
										description: `Model ${currentModel} sent a text/thinking message with no execution tools and immediately called todo to mark tasks complete.`,
										details: {
											eventIndex: i,
											todoEventIndex: j,
											model: currentModel,
											messageSnippet: (text || thinking).slice(0, 250),
											todoIntent: intent,
											todoArgs: args,
										},
									});
								}
							}
							break;
						} else if (
							nextEvent.type === "message" &&
							nextEvent.message?.role === "user"
						) {
							break;
						}
					}
				}
			}

			// 2. Check: Consecutive todo tool calls in a flurry
			if (e.type === "custom" && e.customType === "tool_execution_start") {
				const toolName = e.data?.toolName;
				const intent = typeof e.data?.intent === "string" ? e.data.intent : "";
				const args = e.data?.args;

				if (toolName === "todo") {
					if (consecutiveTodoCount === 0) {
						consecutiveTodoStartIndex = i;
					}
					consecutiveTodoCount++;
					consecutiveTodoIntents.push(
						intent || `call #${consecutiveTodoCount}`,
					);

					// Also check: Todo done right after a tool error
					if (lastToolResultWasError && isTodoDone(intent, args)) {
						matches.push({
							patternId: "TODO_DONE_AFTER_UNRESOLVED_ERROR",
							name: "Todo Marked Done Immediately After Tool Failure",
							severity: "high",
							description: `Model ${currentModel} marked a todo task done immediately after an unhandled tool error without fixing or re-running the failed command.`,
							details: {
								eventIndex: i,
								model: currentModel,
								todoIntent: intent,
								priorErrorSnippet: lastToolErrorSnippet,
							},
						});
						// Reset error flag so we don't duplicate on same error
						lastToolResultWasError = false;
					}
				} else {
					// If we had 3+ consecutive todo calls before this tool, record the flurry
					if (consecutiveTodoCount >= 3) {
						matches.push({
							patternId: "CONSECUTIVE_TODO_FLURRY",
							name: "Rapid Consecutive Todo Done Flurry Without Intervening Work",
							severity: consecutiveTodoCount >= 6 ? "critical" : "high",
							description: `Model ${currentModel} executed ${consecutiveTodoCount} consecutive todo operations without any intervening commands, tests, or edits.`,
							details: {
								eventIndex: consecutiveTodoStartIndex,
								model: currentModel,
								consecutiveCount: consecutiveTodoCount,
								intents: consecutiveTodoIntents.slice(0, 10),
							},
						});
					}
					consecutiveTodoCount = 0;
					consecutiveTodoIntents = [];
					consecutiveTodoStartIndex = -1;
				}
			}
		}

		// Trailing check at end of session
		if (consecutiveTodoCount >= 3) {
			matches.push({
				patternId: "CONSECUTIVE_TODO_FLURRY",
				name: "Rapid Consecutive Todo Done Flurry Without Intervening Work",
				severity: consecutiveTodoCount >= 6 ? "critical" : "high",
				description: `Model ${currentModel} executed ${consecutiveTodoCount} consecutive todo operations at session end without any intervening work.`,
				details: {
					eventIndex: consecutiveTodoStartIndex,
					model: currentModel,
					consecutiveCount: consecutiveTodoCount,
					intents: consecutiveTodoIntents.slice(0, 10),
				},
			});
		}

		return matches;
	},
};
