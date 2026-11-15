// Cloud-neural TTS via VoiPi's Edge provider: Microsoft Edge's neural speech
// service — 322+ voices, no API key, MP3 output. It is the bottom online tier
// of the chain: better quality than Piper for most languages, no key needed,
// but it requires network access — and Microsoft currently 403-blocks
// non-browser WebSocket clients, so Google (voipi-google) sits above it.
//
// Config:
//   TTS_EDGE_VOICE         voice id override, e.g. fr-FR-DeniseNeural
//                          (default: voipi's map for the listening language)
import { EdgeTTS } from "voipi/edge-tts";
import { listeningLanguage } from "../../config";

const EDGE_VOICE = process.env.TTS_EDGE_VOICE;

let provider: EdgeTTS | undefined;

function getEdge(): EdgeTTS {
	provider ??= new EdgeTTS(EDGE_VOICE ? { voice: EDGE_VOICE } : {});
	return provider;
}

export async function probeEdgeTts(): Promise<{ available: boolean; detail: string }> {
	// No key to check and no local binary — availability is a network question
	// answered at synthesis time; the seam falls back if offline.
	return {
		available: true,
		detail: `online, no API key (voice ${EDGE_VOICE ?? "auto by language"})`,
	};
}

/**
 * Synthesize speech with Edge's neural voices. Returns base64-encoded MP3.
 * Throws on failure — the TTS service (server/voice/tts/service.ts) handles
 * the fallback chain and provenance.
 */
export async function textToSpeechEdgeTts(text: string): Promise<string> {
	const normalizedText = text.trim();
	if (!normalizedText) return "";

	const audio = await getEdge().toAudio(normalizedText, {
		lang: listeningLanguage(),
	});
	if (!audio.data || audio.data.length === 0) {
		throw new Error("Edge TTS produced no audio");
	}
	return audio.data.toString("base64");
}
