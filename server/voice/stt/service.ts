import { transcribeAudio } from "./providers/elevenlabs";
import { transcribeWhisperLocal } from "./local/router";

/**
 * STT engine seam (LIFT-PLAN Stage 4): elevenlabs (cloud) vs whisper-local
 * (faster-whisper / whisper.cpp server, fr). Callers ask for an engine; the
 * seam dispatches, measures latency and falls back to the remaining engine
 * on failure. Provenance always names the engine that actually transcribed.
 */
export type SttEngineId = "elevenlabs" | "whisper-local";

export const STT_ENGINE_IDS: readonly SttEngineId[] = [
	"elevenlabs",
	"whisper-local",
] as const;

export interface SttProvenance {
	/** Engine that actually produced the transcript. */
	engine: SttEngineId;
	/** Requested engine when it failed and a fallback transcribed. */
	fallbackFrom: SttEngineId | null;
	latencyMs: number;
}

export interface SttResult {
	text: string;
	provenance: SttProvenance;
}

export function isSttEngineId(value: unknown): value is SttEngineId {
	return (
		typeof value === "string" &&
		(STT_ENGINE_IDS as readonly string[]).includes(value)
	);
}

/** Narrow an untrusted value (env var, WS command) to an STT engine id. */
export function resolveSttEngine(value: unknown, fallback: SttEngineId): SttEngineId {
	return isSttEngineId(value) ? value : fallback;
}

function runEngine(
	engine: SttEngineId,
	audioBuffer: Buffer,
	mimeType: string,
): Promise<string> {
	switch (engine) {
		case "elevenlabs":
			return transcribeAudio(audioBuffer, mimeType);
		case "whisper-local":
			return transcribeWhisperLocal(audioBuffer, mimeType);
	}
}

/**
 * Transcribe audio with the requested engine, falling back to the remaining
 * engine on failure. Throws only when every engine fails.
 */
export async function transcribeSpeech(
	audioBuffer: Buffer,
	mimeType: string,
	requested: SttEngineId,
): Promise<SttResult> {
	const chain: SttEngineId[] = [
		requested,
		...STT_ENGINE_IDS.filter((engine) => engine !== requested),
	];

	let fallbackFrom: SttEngineId | null = null;
	let lastError: Error | null = null;
	for (const engine of chain) {
		const startedAt = Date.now();
		try {
			const text = await runEngine(engine, audioBuffer, mimeType);
			const latencyMs = Date.now() - startedAt;
			if (fallbackFrom) {
				console.warn(
					`[stt] fallback: ${fallbackFrom} failed → ${engine} succeeded (${latencyMs}ms)`,
				);
			}
			return {
				text,
				provenance: { engine, fallbackFrom, latencyMs },
			};
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			console.warn(`[stt] ${engine} failed: ${lastError.message}`);
			fallbackFrom ??= engine;
		}
	}

	throw lastError ?? new Error("All STT engines failed");
}
