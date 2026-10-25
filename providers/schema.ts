// providers/schema.ts — per-provider schema TOML loader.
// Tau and kappa each ship providers/schemas/<name>.toml declaring the source
// contract (tables/columns/fields); loaders are driven by these files.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "smol-toml";

export interface ProviderSchema {
	provider: { name: string; label: string; kind: "jsonl" | "sqlite" };
	source: {
		db?: string;
		dir?: string;
		legacy_dir?: string;
		file_glob?: string;
		readonly?: boolean;
	};
	sessions?: Record<string, string>;
	messages?: Record<string, string>;
	todos?: Record<string, string>;
	events?: Record<string, string>;
	parts?: Record<string, string>;
	checks?: Record<string, boolean>;
	event_fields?: Record<string, string>;
}

const SCHEMAS_DIR = join(__dirname, "schemas");

export function readProviderSchema(name: string): ProviderSchema {
	const p = join(SCHEMAS_DIR, `${name}.toml`);
	try {
		return parse(readFileSync(p, "utf-8")) as unknown as ProviderSchema;
	} catch (e) {
		throw new Error(
			`session-audit: cannot read schema ${p}: ${String(e).slice(0, 140)}`,
		);
	}
}

export function expandHome(p: string | undefined): string | undefined {
	if (!p) return undefined;
	return p.startsWith("~/")
		? join(process.env.HOME || "/home/toxic", p.slice(2))
		: resolve(p);
}

export function schemaPath(name: string): string {
	return join(SCHEMAS_DIR, `${name}.toml`);
}
export const SCHEMAS_DIR_EXPORT = SCHEMAS_DIR;
