// Shared voice-stack configuration: the single place where STT/TTS env
// knobs live, plus the tiny helpers every provider reuses (probe result
// shape, language→voice resolution). Keeps the import graph one-directional:
// providers → config → (nothing).

// --- STT ---
export const WHISPER_STT_URL = process.env.WHISPER_STT_URL ?? "http://127.0.0.1:8080/inference";
export const WHISPER_STT_LANGUAGE = process.env.WHISPER_STT_LANGUAGE ?? "fr";
export const WHISPER_STT_TIMEOUT_MS = Number(process.env.WHISPER_STT_TIMEOUT_MS ?? 8000);

// --- Probe result shape shared by all engine probes (dashboard + seams) ---
export interface EngineProbe {
	available: boolean;
	detail: string;
	/** Setup steps shown in the dashboard when the engine is unavailable. */
	setupHint?: string;
}

/** ISO code of the listening language ("fr"), the app's voice context. */
export function listeningLanguage(): string {
	return WHISPER_STT_LANGUAGE.slice(0, 2).toLowerCase();
}

/**
 * DRY resolution for provider voices: explicit env override → per-language
 * map → provider fallback. Used by every TTS provider.
 */
export function voiceForLanguage(
	map: Record<string, string>,
	fallback: string,
	envOverride?: string,
): string {
	return envOverride ?? map[listeningLanguage()] ?? fallback;
}
