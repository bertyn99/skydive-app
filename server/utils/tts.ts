import { textToSpeechElevenLabs } from "./elevenlabs-tts";
import { textToSpeechMistral } from "./mistral-tts";
import { textToSpeechPiperLocal } from "./piper-tts";

/**
 * TTS engine seam (LIFT-PLAN Stage 4): elevenlabs | mistral (cloud) vs
 * piper-local (offline, fr_FR, ~100ms). Callers ask for an engine; the seam
 * dispatches, measures latency and falls back down the remaining engines on
 * failure. Provenance always names the engine that actually produced audio.
 */
export type TtsEngineId = "elevenlabs" | "mistral" | "piper-local";

export const TTS_ENGINE_IDS: readonly TtsEngineId[] = [
	"elevenlabs",
	"mistral",
	"piper-local",
] as const;

const MIME_BY_ENGINE: Record<TtsEngineId, "audio/mpeg" | "audio/wav"> = {
	elevenlabs: "audio/mpeg",
	mistral: "audio/mpeg",
	"piper-local": "audio/wav",
};

export interface TtsProvenance {
	/** Engine that actually produced the audio. */
	engine: TtsEngineId;
	/** Requested engine when it failed and a fallback produced the audio. */
	fallbackFrom: TtsEngineId | null;
	latencyMs: number;
	/** True when served from the engine's dedup cache (latency ≈ 0ms). */
	cached: boolean;
}

export interface TtsResult {
	/** Base64-encoded audio (MP3 for cloud engines, WAV for piper-local). */
	audio: string;
	mimeType: "audio/mpeg" | "audio/wav";
	provenance: TtsProvenance;
}

export function isTtsEngineId(value: unknown): value is TtsEngineId {
	return (
		typeof value === "string" &&
		(TTS_ENGINE_IDS as readonly string[]).includes(value)
	);
}

/** Narrow an untrusted value (env var, WS command) to a TTS engine id. */
export function resolveTtsEngine(value: unknown, fallback: TtsEngineId): TtsEngineId {
	return isTtsEngineId(value) ? value : fallback;
}

function runEngine(
	engine: TtsEngineId,
	text: string,
): Promise<{ audio: string; cached: boolean }> {
	switch (engine) {
		case "elevenlabs":
			return textToSpeechElevenLabs(text);
		case "mistral":
			return textToSpeechMistral(text).then((audio) => ({ audio, cached: false }));
		case "piper-local":
			return textToSpeechPiperLocal(text).then((audio) => ({
				audio,
				cached: false,
			}));
	}
}

/**
 * Synthesize speech with the requested engine, falling back through the
 * remaining engines on failure. Returns null when every engine fails —
 * the caller decides to skip the audio broadcast (SILENCE wins).
 */
export async function synthesizeSpeech(
	text: string,
	requested: TtsEngineId,
): Promise<TtsResult | null> {
	const chain: TtsEngineId[] = [
		requested,
		...TTS_ENGINE_IDS.filter((engine) => engine !== requested),
	];

	let fallbackFrom: TtsEngineId | null = null;
	for (const engine of chain) {
		const startedAt = Date.now();
		try {
			const { audio, cached } = await runEngine(engine, text);
			if (!audio) throw new Error("engine returned empty audio");
			const latencyMs = Date.now() - startedAt;
			if (fallbackFrom) {
				console.warn(
					`[tts] fallback: ${fallbackFrom} failed → ${engine} succeeded (${latencyMs}ms)`,
				);
			}
			return {
				audio,
				mimeType: MIME_BY_ENGINE[engine],
				provenance: { engine, fallbackFrom, latencyMs, cached },
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.warn(`[tts] ${engine} failed: ${message}`);
			fallbackFrom ??= engine;
		}
	}

	return null;
}
