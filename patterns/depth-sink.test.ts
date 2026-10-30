import { describe, expect, test } from "bun:test";
import { depthSinkDetector, pathDepth } from "./depth-sink";
import { getAllDetectors, runAllPatterns } from "./index";
import type { SessionEvent } from "./types";

const CWD = "/home/toxic/proj";

function event(args: Record<string, unknown>): SessionEvent {
	return { type: "tool_call", data: { toolName: "read", args } };
}

describe("pathDepth", () => {
	test("counts levels below cwd only", () => {
		expect(pathDepth(CWD, `${CWD}/a/b/c.ts`)).toBe(3);
		expect(pathDepth(CWD, CWD)).toBe(0);
		expect(pathDepth(CWD, "/elsewhere/a/b")).toBe(0); // outside cwd: not a sink
	});
});

describe("depthSinkDetector — real-behavior contracts", () => {
	test("sustained deep sink (vendored/build tail) is flagged", () => {
		const events = Array.from({ length: 7 }, (_, i) =>
			event({ path: `/home/toxic/proj/d0/d1/d2/d3/d4/d5/d6/d7/d8/d9/d10/d11/d12/pnpm/f${i}.ts` }),
		);
		const matches = depthSinkDetector.detect(events, { file: "s.jsonl", model: "m", cwd: CWD });
		expect(matches).toHaveLength(1);
		expect(matches[0]!.details.consecutiveCount).toBe(7);
	});

	test("six consecutive deep calls threshold not met at five", () => {
		const events = Array.from({ length: 5 }, (_, i) => event({ path: `/home/toxic/proj/d0/d1/d2/d3/d4/d5/d6/d7/d8/d9/d10/d11/d12/x/f${i}.ts` }));
		expect(depthSinkDetector.detect(events, { file: "s.jsonl", model: "m", cwd: CWD })).toHaveLength(0);
	});

	test("shallow work between deep runs breaks the sink", () => {
		const events = [
			...Array.from({ length: 5 }, (_, i) => event({ path: `/home/toxic/proj/d0/d1/d2/d3/d4/d5/d6/d7/d8/d9/d10/d11/d12/x/f${i}.ts` })),
			event({ path: `${CWD}/src/index.ts` }), // back to source: run broken
			...Array.from({ length: 5 }, (_, i) => event({ path: `/home/toxic/proj/d0/d1/d2/d3/d4/d5/d6/d7/d8/d9/d10/d11/d12/y/f${i}.ts` })),
		];
		expect(depthSinkDetector.detect(events, { file: "s.jsonl", model: "m", cwd: CWD })).toHaveLength(0);
	});

	test("relative paths never count (no cwd, no sink)", () => {
		const events = Array.from({ length: 8 }, (_, i) => event({ path: `node_modules/x/f${i}.ts` }));
		expect(depthSinkDetector.detect(events, { file: "s.jsonl", model: "m", cwd: CWD })).toHaveLength(0);
	});

	test("detector is registered first-class in the kleio registry", () => {
		expect(getAllDetectors().some(d => d.id === "workspace-depth-sink")).toBe(true);
		const events = Array.from({ length: 7 }, (_, i) =>
			event({ path: `/home/toxic/proj/d0/d1/d2/d3/d4/d5/d6/d7/d8/d9/d10/d11/d12/f${i}.js` }),
		);
		expect(runAllPatterns(events, { file: "s.jsonl", model: "m", cwd: CWD }).some(m => m.patternId === "workspace-depth-sink")).toBe(true);
	});
});
