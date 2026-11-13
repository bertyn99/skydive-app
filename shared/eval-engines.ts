/**
 * Framework-neutral matrix engine ids (LIFT-PLAN Stage 5). Shared between the
 * eval runner (server) and the dashboard (client) — must stay free of server
 * imports (no node APIs, no process.env) so the client bundle stays clean.
 */

export type MatrixEngineId = "fused" | "gate:gemini" | "gate:local" | "gate:rules";

export const MATRIX_ENGINES: readonly {
	id: MatrixEngineId;
	label: string;
}[] = [
	{ id: "fused", label: "Fused Gemini (baseline)" },
	{ id: "gate:gemini", label: "Gate: Gemini decision" },
	{ id: "gate:local", label: "Gate: self-hosted (OpenAI-compatible)" },
	{ id: "gate:rules", label: "Gate: reflex rules (no vision)" },
] as const;

export function isMatrixEngineId(value: unknown): value is MatrixEngineId {
	return (
		typeof value === "string" &&
		(MATRIX_ENGINES as readonly { id: string }[]).some((entry) => entry.id === value)
	);
}

/** The Gate engine behind a matrix engine id ("fused" has none). */
export function gateEngineOf(engine: MatrixEngineId): "gemini" | "local" | "rules" {
	return engine === "gate:gemini"
		? "gemini"
		: engine === "gate:local"
			? "local"
			: "rules";
}
