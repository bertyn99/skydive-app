// Composer engine service (Stage 6): a registry of compose engines with an
// env-overridable fallback chain, mirroring server/voice/tts/service.ts.
//
//   gemini-cloud (key) — compose-only Gemini call, current baseline
//   local (OpenAI-compatible) — self-hosted vision model (Ollama/LM Studio/
//                              vLLM), e.g. Qwen2.5-VL
//
// Default chain: gemini-cloud (cloud-first, preserving current behavior);
// COMPOSER_CHAIN="local,gemini-cloud" flips it for offline-first setups. The
// offline profile (engine.ts) selects the local engine explicitly.
//
// Callers ask for an engine; the service dispatches, measures latency and
// falls down the remaining engines on failure. Provenance always names the
// engine that actually composed.
import { composeGeminiCloud } from "./providers/gemini-cloud";
import { composeLocal } from "./providers/local";
import { COMPOSER_LOCAL_BASE_URL, COMPOSER_LOCAL_MODEL } from "./config";
import { GEMINI_MODEL_ID } from "../utils/gemini";
import type { ComposeInput, ComposeOutput } from "./config";

export type ComposerEngineId = "gemini-cloud" | "local";

export const COMPOSER_ENGINE_IDS: readonly ComposerEngineId[] = [
	"gemini-cloud",
	"local",
] as const;

export interface ComposerEngineProbe {
	available: boolean;
	detail: string;
	setupHint?: string;
}

interface ComposerEngineEntry {
	id: ComposerEngineId;
	label: string;
	/** "cloud" (API key) or "local" (offline). */
	kind: "cloud" | "local";
	compose(input: ComposeInput): Promise<ComposeOutput>;
	probe(): Promise<ComposerEngineProbe>;
}

const REGISTRY: Record<ComposerEngineId, ComposerEngineEntry> = {
	"gemini-cloud": {
		id: "gemini-cloud",
		label: "Gemini (cloud composer)",
		kind: "cloud",
		compose: composeGeminiCloud,
		probe: async () =>
			process.env.GOOGLE_GENERATIVE_AI_API_KEY
				? { available: true, detail: `${GEMINI_MODEL_ID} (key set)` }
				: {
						available: false,
						detail: "GOOGLE_GENERATIVE_AI_API_KEY missing — cloud composer unavailable",
						setupHint: "Set GOOGLE_GENERATIVE_AI_API_KEY in .env",
					},
	},
	local: {
		id: "local",
		label: "Local VLM (OpenAI-compatible)",
		kind: "local",
		compose: composeLocal,
		probe: async () => {
			try {
				const url = `${COMPOSER_LOCAL_BASE_URL.replace(/\/+$/, "")}/models`;
				const res = await fetch(url, { signal: AbortSignal.timeout(1200) });
				return res.ok
					? { available: true, detail: `${COMPOSER_LOCAL_MODEL} at ${COMPOSER_LOCAL_BASE_URL}` }
					: { available: false, detail: `${url} responded ${res.status}` };
			} catch (err) {
				return {
					available: false,
					detail: `no composer model at ${COMPOSER_LOCAL_BASE_URL} (${err instanceof Error ? err.message : String(err)})`,
					setupHint:
						"Start a vision model on an OpenAI-compatible server (e.g. `ollama pull qwen2.5vl:7b`), or set COMPOSER_LOCAL_BASE_URL",
				};
			}
		},
	},
};

/** Default fallback chain — cloud-first today; COMPOSER_CHAIN overrides. */
function defaultChain(): ComposerEngineId[] {
	const envChain = process.env.COMPOSER_CHAIN?.split(",")
		.map((id) => id.trim())
		.filter((id): id is ComposerEngineId => isComposerEngineId(id));
	return envChain && envChain.length > 0 ? envChain : ["gemini-cloud"];
}

/** Engine used when nothing is requested (COMPOSER_ENGINE beats the chain). */
export function defaultComposerEngine(): ComposerEngineId {
	if (process.env.COMPOSER_ENGINE && isComposerEngineId(process.env.COMPOSER_ENGINE)) {
		return process.env.COMPOSER_ENGINE;
	}
	return defaultChain()[0];
}

export function isComposerEngineId(value: unknown): value is ComposerEngineId {
	return (
		typeof value === "string" &&
		(COMPOSER_ENGINE_IDS as readonly string[]).includes(value)
	);
}

/** Narrow an untrusted value (env var, WS command) to a composer engine id. */
export function resolveComposerEngine(
	value: unknown,
	fallback: ComposerEngineId,
): ComposerEngineId {
	return isComposerEngineId(value) ? value : fallback;
}

export function composerEngineLabel(id: ComposerEngineId): string {
	return REGISTRY[id].label;
}

export interface ComposerProvenance {
	/** Engine that actually composed the observation. */
	engine: ComposerEngineId;
	/** Model id that actually composed (provenance). */
	modelId: string;
	/** Requested engine when it failed and a fallback composed instead. */
	fallbackFrom: ComposerEngineId | null;
	latencyMs: number;
}

export interface ComposerResult {
	observation: string | null;
	relevance: number;
	actions: Array<{ type: string; params: Record<string, unknown> }>;
	provenance: ComposerProvenance;
}

/** Availability probe for one engine (dashboard setup hints). */
export async function probeComposerEngine(
	id: ComposerEngineId,
): Promise<ComposerEngineProbe> {
	return REGISTRY[id].probe();
}

/**
 * Compose an observation with the requested engine, falling down the chain
 * on failure. Returns null when every engine fails — the caller records a
 * gate tombstone and broadcasts SILENCE.
 */
export async function compose(
	input: ComposeInput,
	requested: ComposerEngineId,
): Promise<ComposerResult | null> {
	const chain: ComposerEngineEntry[] = [
		REGISTRY[requested],
		...defaultChain()
			.filter((entry) => entry.id !== requested)
			.map((id) => REGISTRY[id]),
	];

	let fallbackFrom: ComposerEngineId | null = null;
	for (const entry of chain) {
		const startedAt = Date.now();
		try {
			const output = await entry.compose(input);
			const latencyMs = Date.now() - startedAt;
			if (fallbackFrom) {
				console.warn(
					`[composer] fallback: ${fallbackFrom} failed → ${entry.id} succeeded (${latencyMs}ms)`,
				);
			}
			return {
				observation: output.observation,
				relevance: output.relevance,
				actions: output.actions,
				provenance: {
					engine: entry.id,
					modelId: output.modelId,
					fallbackFrom,
					latencyMs,
				},
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.warn(`[composer] ${entry.id} failed: ${message}`);
			fallbackFrom ??= entry.id;
		}
	}

	return null;
}
