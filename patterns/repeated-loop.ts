// Pattern: Repeated Command Failure Loop
// Detects models repeating the exact same failing command or error 3+ times without adapting.

import type {
  PatternDetector,
  PatternMatch,
  SessionContext,
  SessionEvent,
} from "./types";

export const repeatedLoopDetector: PatternDetector = {
  id: "repeated-loop",
  name: "Repeated Command Failure Loop",
  description:
    "Detects sessions where the model repeats failing commands or hits the exact same error multiple times without diagnosing the underlying cause.",

  detect(events: SessionEvent[], context?: SessionContext): PatternMatch[] {
    const matches: PatternMatch[] = [];
    let currentModel = context?.model || "unknown";

    const errorCounts = new Map<
      string,
      { count: number; firstIndex: number; model: string }
    >();

    for (let i = 0; i < events.length; i++) {
      const e = events[i];

      if (e.type === "model_change" && typeof e.model === "string") {
        currentModel = e.model;
      }

      if (e.type === "message" && e.message?.role === "toolResult") {
        const isError = Boolean(e.message.isError);
        const contentStr = textFromContent(e.message.content);
        const alsoError = isError
          ? true
          : /(error ts|cannot read file|rule_violation)/i.test(contentStr);

        if (alsoError) {
          // Normalize error snippet key (first 80 chars)
          const key = contentStr.replace(/\s+/g, " ").slice(0, 80);
          const existing = errorCounts.get(key) || {
            count: 0,
            firstIndex: i,
            model: currentModel,
          };
          existing.count++;
          errorCounts.set(key, existing);
        }
      }
    }

    for (const [key, data] of errorCounts.entries()) {
      if (data.count >= 3) {
        matches.push({
          patternId: "REPEATED_COMMAND_LOOP",
          name: "Repeated Tool Failure Loop",
          severity: data.count >= 5 ? "critical" : "high",
          description: `Model ${data.model} hit the same error ${data.count} times without adapting.`,
          details: {
            eventIndex: data.firstIndex,
            model: data.model,
            repeatCount: data.count,
            errorSnippet: key,
          },
        });
      }
    }

    return matches;
  },
};

/**
 * Extract readable text from a tool-result `content` payload.
 *
 * Real tau/kappa sessions store structured content (e.g. a list of
 * `{ type: "text", text: "..." }` blocks, or strings). Naive `String(content)`
 * on such a list flattens every object to `"[object Object]"`, which bubbled up
 * as a 4597× `[object Object]` snippet in kleio_failures. Recurse into the
 * structure and pull `.text` / `.output` / `.content` fields when present.
 */
export function textFromContent(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (typeof content === "number" || typeof content === "boolean")
    return String(content);
  if (Array.isArray(content))
    return content.map((c) => textFromContent(c)).join("\n");
  if (typeof content === "object") {
    const c = content as Record<string, unknown>;
    // Prefer the most informative fields, in order.
    for (const k of [
      "text",
      "output",
      "message",
      "stderr",
      "stdout",
      "content",
    ]) {
      const v = c[k];
      if (typeof v === "string" && v.length > 0) {
        const rest = textFromContent({ ...c, [k]: undefined });
        return v + (rest ? "\n" + rest : "");
      }
    }
    const keys = Object.keys(c);
    if (keys.length === 1 && keys[0] === "type") return "";
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }
  return String(content);
}
