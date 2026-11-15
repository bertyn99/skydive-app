// TTS engine service: a platform-aware registry of engines with a default
// fallback chain per OS, and env overrides. Engines:
//
//   cloud    elevenlabs (key)          — ElevenLabsTtsResult dedup cache
//            mistral (key)             — Voxtral
//   local    piper-local (voipi)       — neural, offline; binary + voice
//                                        auto-install on first use
//            voipi-macos (say)         — macOS only, zero download, WAV
//   online   voipi-edge                — neural, no key, needs network
//
// Default chain per platform (best for our app first):
//   darwin:       voipi-macos → piper-local → voipi-edge → elevenlabs → mistral
//   linux/win32:  piper-local → voipi-edge → elevenlabs → mistral
// Override with TTS_CHAIN="piper-local,elevenlabs" (comma-separated ids).
//
// Callers ask for an engine; the service dispatches, measures latency and
// falls back down the remaining engines on failure. Provenance always names
// the engine that actually produced audio.
import { textToSpeechElevenLabs } from "./providers/elevenlabs";
import { textToSpeechMistral } from "./providers/mistral";
import { probePiper, textToSpeechPiperLocal } from "./providers/piper";
import { probeGoogleTts, textToSpeechGoogleTts } from "./providers/google";
import { probeMacosSay, textToSpeechMacosSay } from "./providers/say.darwin";
import { probeEdgeTts, textToSpeechEdgeTts } from "./providers/edge";

export type TtsEngineId =
	| "elevenlabs"
	| "mistral"
	| "piper-local"
	| "voipi-macos"
	| "voipi-google"
	| "voipi-edge";

export const TTS_ENGINE_IDS: readonly TtsEngineId[] = [
	"elevenlabs",
	"mistral",
	"piper-local",
	"voipi-macos",
	"voipi-google",
	"voipi-edge",
] as const;

export interface TtsEngineProbe {
	available: boolean;
	detail: string;
	setupHint?: string;
}

type Platform = "darwin" | "linux" | "win32";

interface TtsEngineEntry {
	id: TtsEngineId;
	label: string;
	/** Platforms the engine applies to; undefined = every platform. */
	platforms?: Platform[];
	/** "cloud" (API key), "local" (offline), "online" (no key, needs network). */
	kind: "cloud" | "local" | "online";
	mime: "audio/mpeg" | "audio/wav";
	synthesize(text: string): Promise<{ audio: string; cached: boolean }>;
	probe(): Promise<TtsEngineProbe>;
}

const REGISTRY: Record<TtsEngineId, TtsEngineEntry> = {
	elevenlabs: {
		id: "elevenlabs",
		label: "ElevenLabs (cloud)",
		kind: "cloud",
		mime: "audio/mpeg",
		synthesize: async (text) => {
			const result = await textToSpeechElevenLabs(text);
			return { audio: result.audio, cached: result.cached };
		},
		probe: async () =>
			process.env.ELEVENLABS_API_KEY
				? { available: true, detail: "ELEVENLABS_API_KEY set" }
				: { available: false, detail: "ELEVENLABS_API_KEY missing — cloud TTS unavailable", setupHint: "Set ELEVENLABS_API_KEY in .env" },
	},
	mistral: {
		id: "mistral",
		label: "Mistral Voxtral (cloud)",
		kind: "cloud",
		mime: "audio/mpeg",
		synthesize: async (text) => ({ audio: await textToSpeechMistral(text), cached: false }),
		probe: async () =>
			process.env.MISTRAL_API_KEY
				? { available: true, detail: "MISTRAL_API_KEY set" }
				: { available: false, detail: "MISTRAL_API_KEY missing — cloud TTS unavailable", setupHint: "Set MISTRAL_API_KEY in .env" },
	},
	"piper-local": {
		id: "piper-local",
		label: "Piper (local, via VoiPi)",
		kind: "local",
		mime: "audio/wav",
		synthesize: async (text) => ({ audio: await textToSpeechPiperLocal(text), cached: false }),
		probe: probePiper,
	},
	"voipi-macos": {
		id: "voipi-macos",
		label: "macOS say (local)",
		platforms: ["darwin"],
		kind: "local",
		mime: "audio/wav",
		synthesize: async (text) => ({ audio: await textToSpeechMacosSay(text), cached: false }),
		probe: async () => {
			const probe = await probeMacosSay();
			return { available: probe.available, detail: probe.detail };
		},
	},
	"voipi-google": {
		id: "voipi-google",
		label: "Google TTS (online, keyless)",
		kind: "online",
		mime: "audio/mpeg",
		synthesize: async (text) => ({ audio: await textToSpeechGoogleTts(text), cached: false }),
		probe: probeGoogleTts,
	},
	"voipi-edge": {
		id: "voipi-edge",
		label: "Edge TTS (online, keyless)",
		kind: "online",
		mime: "audio/mpeg",
		synthesize: async (text) => ({ audio: await textToSpeechEdgeTts(text), cached: false }),
		probe: probeEdgeTts,
	},
};

function currentPlatform(): Platform {
	return process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "win32" : "linux";
}

/** The default fallback chain for this platform, TTS_CHAIN env overriding. */
function defaultChain(): TtsEngineEntry[] {
	const platform = currentPlatform();
	const platformOrder: Record<Platform, TtsEngineId[]> = {
		// Google (translate endpoint) sits above Edge: both keyless and online,
		// but Edge currently 403-blocks server clients while Google works.
		darwin: ["voipi-macos", "piper-local", "voipi-google", "voipi-edge", "elevenlabs", "mistral"],
		linux: ["piper-local", "voipi-google", "voipi-edge", "elevenlabs", "mistral"],
		win32: ["piper-local", "voipi-google", "voipi-edge", "elevenlabs", "mistral"],
	};
	const envChain = process.env.TTS_CHAIN?.split(",")
		.map((id) => id.trim())
		.filter((id): id is TtsEngineId => isTtsEngineId(id));
	const ids = envChain && envChain.length > 0 ? envChain : platformOrder[platform];
	return ids
		.map((id) => REGISTRY[id])
		.filter((entry) => !entry.platforms || entry.platforms.includes(platform));
}

/** Engine to use when nothing is requested (TTS_ENGINE env beats the chain). */
export function defaultTtsEngine(): TtsEngineId {
	if (process.env.TTS_ENGINE && isTtsEngineId(process.env.TTS_ENGINE)) {
		return process.env.TTS_ENGINE;
	}
	return defaultChain()[0]?.id ?? "elevenlabs";
}

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
	/** Base64-encoded audio (MP3 for cloud/edge, WAV for local engines). */
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

export function ttsEngineLabel(id: TtsEngineId): string {
	return REGISTRY[id].label;
}

/** Availability probe for one engine (dashboard setup hints). */
export async function probeTtsEngine(id: TtsEngineId): Promise<TtsEngineProbe> {
	return REGISTRY[id].probe();
}

/**
 * Synthesize speech with the requested engine, falling back down the
 * platform chain on failure. Returns null when every engine fails — the
 * caller decides to skip the audio broadcast (SILENCE wins).
 */
export async function synthesizeSpeech(
	text: string,
	requested: TtsEngineId,
): Promise<TtsResult | null> {
	const chain: TtsEngineEntry[] = [
		REGISTRY[requested],
		...defaultChain().filter((entry) => entry.id !== requested),
	];

	let fallbackFrom: TtsEngineId | null = null;
	for (const entry of chain) {
		const startedAt = Date.now();
		try {
			const { audio, cached } = await entry.synthesize(text);
			if (!audio) throw new Error("engine returned empty audio");
			const latencyMs = Date.now() - startedAt;
			if (fallbackFrom) {
				console.warn(
					`[tts] fallback: ${fallbackFrom} failed → ${entry.id} succeeded (${latencyMs}ms)`,
				);
			}
			return {
				audio,
				mimeType: entry.mime,
				provenance: { engine: entry.id, fallbackFrom, latencyMs, cached },
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.warn(`[tts] ${entry.id} failed: ${message}`);
			fallbackFrom ??= entry.id;
		}
	}

	return null;
}
