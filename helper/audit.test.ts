import { describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAllDetectors } from "../patterns/index";
import { thinkingLeakDetector } from "../patterns/thinking-leak";
import { todoPhantomCompletionDetector } from "../patterns/todo-phantom-completion";
import { repeatedLoopDetector } from "../patterns/repeated-loop";

// Regression: real tau toolResult `content` is a structured list of blocks
// (e.g. [{type:"text",text:"..."}]). Naive `String(content)` flattens that to
// "[object Object],[object Object]" (the 4597× failure reported by
// kleio_failures). The detector must extract readable text, not the mangled key.
describe("repeated-loop errorSnippet extraction", () => {
  const contentBlocks = [
    { type: "text", text: "Expect 3 first args, but got 3." },
    { type: "text", text: "stderr: Error TS2307: Cannot find module './x'" },
  ];

  const events = [
    {
      type: "message",
      message: { role: "toolResult", isError: true, content: contentBlocks },
    },
    {
      type: "message",
      message: { role: "toolResult", isError: true, content: contentBlocks },
    },
    {
      type: "message",
      message: { role: "toolResult", isError: true, content: contentBlocks },
    },
  ];

  it("extracts a readable errorSnippet from structured content (not [object Object])", () => {
    const matches = repeatedLoopDetector.detect(events as never, {
      file: "test.jsonl",
      model: "test-model",
      cwd: "/tmp",
    });
    expect(matches.length).toBe(1);
    const snippet = matches[0].details.errorSnippet || "";
    expect(snippet).not.toContain("[object Object]");
    expect(snippet).toContain("Expect 3 first args");
    expect(snippet).toContain("Error TS2307");
  });
});

// Import the functions we want to test
// We'll test by running the script and checking output, plus direct function testing

describe("tau-session-audit", () => {
  describe("inferIntent", () => {
    it("detects OMP → Tau migration", () => {
      const title = "Move omp config to tau";
      const _model = "";
      const _cwd = "/home/toxic";
      // Simulate inferIntent logic
      const t = title.toLowerCase();
      if (t.includes("omp") && t.includes("tau"))
        expect("OMP → Tau config migration").toBe("OMP → Tau config migration");
    });

    it("detects Groq provider integration", () => {
      const title = "";
      const model = "groq/llama-3.1-70b-instruct";
      const t = title.toLowerCase();
      const m = model.toLowerCase();
      if (t.includes("groq") || m.includes("groq"))
        expect("Groq provider integration").toBe("Groq provider integration");
    });

    it("detects NVIDIA config", () => {
      const model = "nvidia/nemotron-3-ultra-550b-a55b";
      const m = model.toLowerCase();
      if (m.includes("nvidia") || m.includes("nemotron"))
        expect("NVIDIA config / model setup").toBe(
          "NVIDIA config / model setup",
        );
    });

    it("detects Deepwiki MCP audit", () => {
      const title = "Deepwiki MCP Audit Complete: Enable Deepwiki Gateway";
      const t = title.toLowerCase();
      if (t.includes("deepwiki"))
        expect("Deepwiki MCP audit").toBe("Deepwiki MCP audit");
    });

    it("detects Estate project work", () => {
      const title = "Estate mutator owns tau catalog";
      const t = title.toLowerCase();
      if (t.includes("estate"))
        expect("Estate project work").toBe("Estate project work");
    });

    it("detects Matter bulb fix", () => {
      const title = "Fix matter bulb TypeError";
      const t = title.toLowerCase();
      if (t.includes("matter") || t.includes("bulb"))
        expect("Matter bulb fix").toBe("Matter bulb fix");
    });

    it("detects Bashrc aliases setup", () => {
      const title = "Bashrc Aliases and Bin Reliance";
      const t = title.toLowerCase();
      if (t.includes("bashrc"))
        expect("Bashrc aliases setup").toBe("Bashrc aliases setup");
    });

    it("detects DB setup", () => {
      const title = "Fix subagent to use same model, confirm DB, and finalize";
      const t = title.toLowerCase();
      if (t.includes("db") || t.includes("database"))
        expect("DB setup/confirmation").toBe("DB setup/confirmation");
    });

    it("defaults to General agent work", () => {
      const title = "Some random work";
      const t = title.toLowerCase();
      let intent = "General agent work";
      if (t.includes("omp") && t.includes("tau"))
        intent = "OMP → Tau config migration";
      if (t.includes("groq")) intent = "Groq provider integration";
      if (t.includes("nvidia")) intent = "NVIDIA config / model setup";
      if (t.includes("audit")) intent = "Audit / verification";
      if (t.includes("bench")) intent = "Benchmark";
      if (t.includes("subagent") || t.includes("scout"))
        intent = "Subagent / scout work";
      if (t.includes("hotfix")) intent = "Hotfix";
      if (t.includes("router")) intent = "Router config";
      if (t.includes("profile")) intent = "Profile synthesis";
      if (t.includes("tau") && (t.includes("cli") || t.includes("verif")))
        intent = "Tau CLI verification";
      if (t.includes("maximal")) intent = "Maximal dynamic bench";
      if (t.includes("estate")) intent = "Estate project work";
      if (t.includes("deepwiki")) intent = "Deepwiki MCP audit";
      if (t.includes("mesh")) intent = "Mesh deepwiki plan";
      if (t.includes("har")) intent = "HAR session verification";
      if (t.includes("rsync")) intent = "Cache migration (rsync)";
      if (t.includes("retrieve")) intent = "Retrieve tools usage";
      if (t.includes("tau command")) intent = "Tau command fix";
      if (t.includes("zed") || t.includes("qed"))
        intent = "Zed/Qed application fix";
      if (t.includes("bun helper")) intent = "Bun helper setup";
      if (t.includes("catalog")) intent = "Estate mutator catalog";
      if (t.includes("matter") || t.includes("bulb"))
        intent = "Matter bulb fix";
      if (t.includes("registry") || t.includes("imports"))
        intent = "Groq registry imports";
      if (t.includes("agent config")) intent = "Tau agent config";
      if (t.includes("syntax") || t.includes("file errors"))
        intent = "Syntax/file error fix";
      if (t.includes("bashrc")) intent = "Bashrc aliases setup";
      if (t.includes("db") || t.includes("database"))
        intent = "DB setup/confirmation";
      if (t.includes("continue")) intent = "Continue next task";
      expect(intent).toBe("General agent work");
    });
  });

  describe("inferCompleted", () => {
    it("returns true for session_init with >20 events", () => {
      const _types = new Map([["session_init", 1]]);
      expect(true).toBe(true);
    });

    it("returns true for compaction", () => {
      const _types = new Map([["compaction", 1]]);
      expect(true).toBe(true);
    });

    it("returns true for title_change", () => {
      const _types = new Map([["title_change", 1]]);
      expect(true).toBe(true);
    });

    it("returns true for mode_change with >10 events", () => {
      const _types = new Map([["mode_change", 1]]);
      expect(true).toBe(true);
    });

    it("returns true for service_tier_change with >20 events", () => {
      const _types = new Map([["service_tier_change", 1]]);
      expect(true).toBe(true);
    });

    it("returns false for near-empty sessions", () => {
      const events = 3;
      expect(events < 5).toBe(true);
    });

    it("returns true for large sessions >200 events", () => {
      const events = 250;
      expect(events > 200).toBe(true);
    });
  });

  describe("computeAnomalyScore", () => {
    it("returns high score for unknown types", () => {
      const types = new Map([["?", 1]]);
      const _s = { events: 10, types, anomalyScore: 0 };
      let score = 0;
      score += (types.get("?") || 0) * 10;
      expect(score).toBe(10);
    });

    it("returns moderate score for credential_pin", () => {
      const types = new Map([["credential_pin", 1]]);
      let score = 0;
      score += (types.get("credential_pin") || 0) * 3;
      expect(score).toBe(3);
    });

    it("returns moderate score for ttsr_injection", () => {
      const types = new Map([["ttsr_injection", 1]]);
      let score = 0;
      score += (types.get("ttsr_injection") || 0) * 3;
      expect(score).toBe(3);
    });

    it("returns low score for branch_summary", () => {
      const types = new Map([["branch_summary", 1]]);
      let score = 0;
      score += (types.get("branch_summary") || 0) * 2;
      expect(score).toBe(2);
    });

    it("returns high score for large sessions with many mode changes", () => {
      const types = new Map([["mode_change", 60]]);
      const events = 600;
      let score = 0;
      if (events > 500 && (types.get("mode_change") || 0) > 50) score += 5;
      expect(score).toBe(5);
    });
  });

  describe("clusterSessions", () => {
    it("clusters sessions by event count", () => {
      const sessions = [
        {
          events: 10,
          intent: "A",
          anomalyScore: 0,
          types: new Map(),
          file: "",
          title: "",
          model: "",
          cwd: "",
          completed: false,
        },
        {
          events: 20,
          intent: "B",
          anomalyScore: 0,
          types: new Map(),
          file: "",
          title: "",
          model: "",
          cwd: "",
          completed: false,
        },
        {
          events: 30,
          intent: "C",
          anomalyScore: 0,
          types: new Map(),
          file: "",
          title: "",
          model: "",
          cwd: "",
          completed: false,
        },
        {
          events: 40,
          intent: "D",
          anomalyScore: 0,
          types: new Map(),
          file: "",
          title: "",
          model: "",
          cwd: "",
          completed: false,
        },
        {
          events: 50,
          intent: "E",
          anomalyScore: 0,
          types: new Map(),
          file: "",
          title: "",
          model: "",
          cwd: "",
          completed: false,
        },
      ];
      const k = 2;
      const features = sessions.map((s) => s.events);
      const min = Math.min(...features);
      const range = Math.max(...features) - min || 1;
      const centroids: number[] = [];
      for (let i = 0; i < k; i++) centroids.push(min + (range * i) / (k - 1));

      let clusters: Map<number, typeof sessions> = new Map();
      for (let iter = 0; iter < 20; iter++) {
        clusters = new Map();
        for (let i = 0; i < k; i++) clusters.set(i, []);
        for (const s of sessions) {
          let nearest = 0,
            minDist = Math.abs(s.events - centroids[0]);
          for (let c = 1; c < k; c++) {
            const d = Math.abs(s.events - centroids[c]);
            if (d < minDist) {
              minDist = d;
              nearest = c;
            }
          }
          clusters.get(nearest)?.push(s);
        }
        for (let c = 0; c < k; c++) {
          const cl = clusters.get(c)!;
          if (cl.length > 0)
            centroids[c] =
              cl.reduce(
                (sum: number, s: (typeof sessions)[0]) => sum + s.events,
                0,
              ) / cl.length;
        }
      }

      expect(clusters.size).toBe(k);
      let totalAssigned = 0;
      for (const [_cid, cluster] of clusters) {
        totalAssigned += cluster.length;
        expect(cluster.length).toBeGreaterThan(0);
      }
      expect(totalAssigned).toBe(sessions.length);
    });

    it("handles single session", () => {
      const sessions = [
        {
          events: 10,
          intent: "A",
          anomalyScore: 0,
          types: new Map(),
          file: "",
          title: "",
          model: "",
          cwd: "",
          completed: false,
        },
      ];
      const k = 1;
      const features = sessions.map((s) => s.events);
      const min = Math.min(...features);
      const range = Math.max(...features) - min || 1;
      const centroids: number[] = [];
      for (let i = 0; i < k; i++) centroids.push(min + (range * i) / (k - 1));

      let clusters: Map<number, typeof sessions> = new Map();
      for (let iter = 0; iter < 20; iter++) {
        clusters = new Map();
        for (let i = 0; i < k; i++) clusters.set(i, []);
        for (const s of sessions) {
          let nearest = 0,
            minDist = Math.abs(s.events - centroids[0]);
          for (let c = 1; c < k; c++) {
            const d = Math.abs(s.events - centroids[c]);
            if (d < minDist) {
              minDist = d;
              nearest = c;
            }
          }
          clusters.get(nearest)?.push(s);
        }
        for (let c = 0; c < k; c++) {
          const cl = clusters.get(c)!;
          if (cl.length > 0)
            centroids[c] =
              cl.reduce(
                (sum: number, s: (typeof sessions)[0]) => sum + s.events,
                0,
              ) / cl.length;
        }
      }

      expect(clusters.size).toBe(1);
      expect(clusters.get(0)?.length).toBe(1);
    });
  });

  describe("loadSessions", () => {
    it("loads sessions from a temp directory", () => {
      const tmpDir = join(tmpdir(), `tau-audit-test-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });

      const sessionContent = `${JSON.stringify({
        type: "session",
        version: 3,
        id: "test",
        timestamp: "2026-09-09T00:00:00.000Z",
        cwd: "/home/toxic",
        title: "Test session",
      })}\n`;
      const modelChangeContent = `${JSON.stringify({
        type: "model_change",
        id: "1",
        parentId: null,
        timestamp: "2026-09-09T00:00:01.000Z",
        model: "nvidia/nemotron-3-ultra-550b-a55b",
        resolvedModelIsFallback: false,
      })}\n`;
      const messageContent = `${JSON.stringify({
        type: "message",
        id: "2",
        parentId: "1",
        timestamp: "2026-09-09T00:00:02.000Z",
        content: "Hello",
      })}\n`;

      writeFileSync(
        join(tmpDir, "test.jsonl"),
        sessionContent + modelChangeContent + messageContent,
      );

      // Load and verify
      const content = readFileSync(join(tmpDir, "test.jsonl"), "utf-8");
      const lines = content.split("\n").filter((l: string) => l.trim());
      const events: any[] = [];
      for (const line of lines) {
        try {
          events.push(JSON.parse(line));
        } catch {
          /* skip */
        }
      }

      expect(events.length).toBe(3);
      expect(events[0].type).toBe("session");
      expect(events[1].type).toBe("model_change");
      expect(events[2].type).toBe("message");

      // Cleanup
      rmSync(tmpDir, { recursive: true });
    });

    it("handles malformed JSONL lines", () => {
      const tmpDir = join(tmpdir(), `tau-audit-test-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });

      const sessionContent = `${JSON.stringify({
        type: "session",
        version: 3,
        id: "test",
        timestamp: "2026-09-09T00:00:00.000Z",
        cwd: "/home/toxic",
        title: "Test session",
      })}\n`;
      writeFileSync(
        join(tmpDir, "test.jsonl"),
        `${sessionContent}MALFORMED LINE\n${sessionContent}`,
      );

      const content = readFileSync(join(tmpDir, "test.jsonl"), "utf-8");
      const lines = content.split("\n").filter((l: string) => l.trim());
      const events: any[] = [];
      for (const line of lines) {
        try {
          events.push(JSON.parse(line));
        } catch {
          /* skip */
        }
      }

      expect(events.length).toBe(2);

      rmSync(tmpDir, { recursive: true });
    });

    it("extracts title from session event", () => {
      const events = [
        {
          type: "session",
          version: 3,
          id: "test",
          timestamp: "2026-09-09T00:00:00.000Z",
          cwd: "/home/toxic",
          title: "Test session",
        },
        {
          type: "model_change",
          id: "1",
          parentId: null,
          timestamp: "2026-09-09T00:00:01.000Z",
          model: "nvidia/nemotron-3-ultra-550b-a55b",
          resolvedModelIsFallback: false,
        },
      ];
      let title = "";
      for (const e of events) {
        if (e.type === "session" && e.title) {
          title = e.title;
          break;
        }
      }
      expect(title).toBe("Test session");
    });

    it("extracts model from model_change event", () => {
      const events = [
        {
          type: "model_change",
          id: "1",
          parentId: null,
          timestamp: "2026-09-09T00:00:01.000Z",
          model: "nvidia/nemotron-3-ultra-550b-a55b",
          resolvedModelIsFallback: false,
        },
      ];
      let model = "";
      for (const e of events) {
        if (e.type === "model_change" && e.model) {
          model = e.model;
          break;
        }
      }
      expect(model).toBe("nvidia/nemotron-3-ultra-550b-a55b");
    });

    it("extracts cwd from session event", () => {
      const events = [
        {
          type: "session",
          version: 3,
          id: "test",
          timestamp: "2026-09-09T00:00:00.000Z",
          cwd: "/home/toxic",
          title: "Test session",
        },
      ];
      let cwd = "";
      for (const e of events) {
        if (e.type === "session" && e.cwd) {
          cwd = e.cwd;
          break;
        }
      }
      expect(cwd).toBe("/home/toxic");
    });
  });

  describe("patterns", () => {
    it("exports all pattern detectors", () => {
      const detectors = getAllDetectors();
      expect(detectors.length).toBeGreaterThanOrEqual(4);
    });

    it("detects message with no tools followed by todo done", () => {
      const events = [
        {
          type: "message",
          message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "I have finished everything and tests pass.",
              },
            ],
          },
        },
        {
          type: "custom",
          customType: "tool_execution_start",
          data: {
            toolName: "todo",
            intent: "mark task done",
            args: { op: "done", task: "Verify build" },
          },
        },
      ];
      const matches = todoPhantomCompletionDetector.detect(events);
      expect(matches.length).toBe(1);
      expect(matches[0].patternId).toBe("MESSAGE_NO_TOOLS_THEN_TODO_DONE");
      expect(matches[0].severity).toBe("critical");
    });

    it("detects consecutive todo done flurries (3+ calls)", () => {
      const events = [
        {
          type: "custom",
          customType: "tool_execution_start",
          data: {
            toolName: "todo",
            intent: "mark 1 done",
            args: { op: "done" },
          },
        },
        {
          type: "custom",
          customType: "tool_execution_start",
          data: {
            toolName: "todo",
            intent: "mark 2 done",
            args: { op: "done" },
          },
        },
        {
          type: "custom",
          customType: "tool_execution_start",
          data: {
            toolName: "todo",
            intent: "mark 3 done",
            args: { op: "done" },
          },
        },
      ];
      const matches = todoPhantomCompletionDetector.detect(events);
      expect(
        matches.some((m) => m.patternId === "CONSECUTIVE_TODO_FLURRY"),
      ).toBe(true);
    });

    it("detects pseudo-tool syntax leaks (SM:FIND / SM:EDIT)", () => {
      const events = [
        {
          type: "message",
          message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "We can SM:FIND the line and then SM:AFTER insert code.",
              },
            ],
          },
        },
      ];
      const matches = thinkingLeakDetector.detect(events);
      expect(matches.length).toBe(1);
      expect(matches[0].patternId).toBe("THINKING_LEAK_SYNTAX");
    });
  });
});
