import { describe, expect, it } from "bun:test";
import type { SessionEvent } from "../patterns/types";
import { evalLoopDetector } from "../patterns/eval-loop";
import { ghostPathDetector } from "../patterns/ghost-path";
import { uiPokeDetector } from "../patterns/ui-poke";

function ev(partial: Partial<SessionEvent> & { type: SessionEvent["type"] }): SessionEvent {
	return partial as SessionEvent;
}

function evalStart(intent: string, i: number): SessionEvent {
	return ev({
		type: "custom",
		customType: "tool_execution_start",
		data: { toolName: "eval", intent, toolCallId: `c${i}` },
	});
}

describe("eval-loop detector", () => {
	it("flags N+ repeated same-intent eval calls with no intervening result-bearing event", () => {
		const events: SessionEvent[] = [];
		for (let i = 0; i < 5; i++) {
			events.push(evalStart("checking local kappa repo state", i));
			events.push(ev({ type: "message", message: { role: "toolResult", content: "Eval cell aborted" } }));
		}
		const matches = evalLoopDetector.detect(events);
		expect(matches.length).toBeGreaterThan(0);
		expect(matches[0]!.patternId).toBe("EVAL_LOOP_FLAILING");
	});

	it("does NOT flag when a different tool or a successful result intervenes", () => {
		const events: SessionEvent[] = [
			evalStart("checking local kappa repo state", 0),
			ev({ type: "message", message: { role: "toolResult", content: "{ ok: true }" } }),
			ev({
				type: "custom",
				customType: "tool_execution_start",
				data: { toolName: "read", intent: "reading config" },
			}),
			evalStart("checking local kappa repo state", 1),
			ev({ type: "message", message: { role: "toolResult", content: "{ ok: true }" } }),
		];
		expect(evalLoopDetector.detect(events)).toHaveLength(0);
	});

	it("escalates severity with kernel-death markers", () => {
		const events: SessionEvent[] = [];
		for (let i = 0; i < 3; i++) {
			events.push(evalStart("probing the box", i));
			events.push(
				ev({
					type: "message",
					message: { role: "toolResult", content: "[kernel] Python kernel shutdown" },
				}),
			);
		}
		const matches = evalLoopDetector.detect(events);
		expect(matches.length).toBeGreaterThan(0);
		expect(matches[0]!.severity).toBe("critical");
	});
});

describe("ghost-path detector", () => {
	it("flags tool args/content referencing the /home/toxic/estate ghost lease path", () => {
		const events: SessionEvent[] = [
			ev({
				type: "custom",
				customType: "tool_execution_start",
				data: {
					toolName: "read",
					intent: "reading oracle intake",
					args: { path: "/home/toxic/pens/estate/ranch/squawk/oracle/bin/post_intake.py" },
				},
			}),
		];
		const matches = ghostPathDetector.detect(events);
		expect(matches.length).toBe(1);
		expect(matches[0]!.patternId).toBe("GHOST_ESTATE_PATH");
		expect(matches[0]!.severity).toBe("high");
	});

	it("ignores the legitimate /home/toxic/pens/estate SSOT", () => {
		const events: SessionEvent[] = [
			ev({
				type: "custom",
				customType: "tool_execution_start",
				data: {
					toolName: "read",
					intent: "reading pitchfork",
					args: { path: "/home/toxic/pens/estate/pitchfork.toml" },
				},
			}),
		];
		expect(ghostPathDetector.detect(events)).toHaveLength(0);
	});
});

describe("ui-poke detector", () => {
	it("flags Player.Open/GUI probes on a media device when source-reading was available earlier in the session", () => {
		const events: SessionEvent[] = [
			ev({
				type: "custom",
				customType: "tool_execution_start",
				data: { toolName: "read", intent: "reading router dispatch" },
			}),
			// later: repeated UI pokes at the device
			...Array.from({ length: 4 }, (_, i) =>
				ev({
					type: "custom",
					customType: "tool_execution_start",
					data: {
						toolName: "eval",
						intent: i % 2 ? "probe GUI window state" : "open player on device",
					},
				}),
			),
		];
		const matches = uiPokeDetector.detect(events);
		expect(matches.length).toBeGreaterThan(0);
		expect(matches[0]!.patternId).toBe("UI_POKE_AS_DIAGNOSIS");
	});

	it("does not flag a single legitimate playback request", () => {
		const events: SessionEvent[] = [
			ev({
				type: "custom",
				customType: "tool_execution_start",
				data: { toolName: "eval", intent: "play requested episode on device" },
			}),
		];
		expect(uiPokeDetector.detect(events)).toHaveLength(0);
	});
});
