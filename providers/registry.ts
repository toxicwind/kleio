// providers/registry.ts — table-driven session-source registry.
// Every session engine registers here; the audit CLI loads through this
// single surface. Add a provider by dropping a module + one registry row.

import { kappaProvider } from "./kappa";
import { tauProvider } from "./tau-jsonl";
import type {
	ProviderSpec,
	ResolvedSession,
	Session,
	SessionSource,
} from "./types";

export const SESSION_PROVIDERS: Record<SessionSource, ProviderSpec> = {
	tau: tauProvider,
	kappa: kappaProvider,
};

export const PROVIDERS: ProviderSpec[] = Object.values(SESSION_PROVIDERS);

/** Load every session from every provider, tagged with its source. */
export function loadAllSessions(): ResolvedSession[] {
	const all: ResolvedSession[] = [];
	for (const provider of PROVIDERS) {
		try {
			const sessions = provider.load();
			for (const s of sessions) all.push({ ...s, source: provider.name });
		} catch (e) {
			console.error(
				`[session-audit] provider ${provider.name} failed: ${String(e).slice(0, 140)}`,
			);
		}
	}
	return all.sort((a, b) => b.events - a.events);
}

/** Load sessions from a specific source (empty filters = all). */
export function loadSessionsFrom(
	sources: SessionSource[] = ["tau", "kappa"],
): ResolvedSession[] {
	const wanted = new Set(sources);
	return loadAllSessions().filter((s) => wanted.has(s.source));
}

/** Re-export contracts so CLI + docs import from one place. */
export type { ProviderSpec, ResolvedSession, Session, SessionSource };
