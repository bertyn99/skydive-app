// Cloud TTS via VoiPi's Google provider: Google Translate's speech endpoint —
// 55+ languages, no API key, MP3 output. Battle-tested and currently more
// reliable from server clients than the Edge endpoint (which 403-blocks
// non-browser WebSockets), so it sits above voipi-edge in the chain.
//
// Config:
//   TTS_GOOGLE_VOICE       language code override, e.g. "fr" (default: the
//                          listening language)
//   TTS_GOOGLE_SLOW        set to 1 for Google's slow speech mode
import { GoogleTTS } from "voipi/google-tts";
import { listeningLanguage, voiceForLanguage } from "../../config";

const GOOGLE_VOICE = process.env.TTS_GOOGLE_VOICE;
const GOOGLE_SLOW = process.env.TTS_GOOGLE_SLOW === "1";

let provider: GoogleTTS | undefined;

function getGoogle(): GoogleTTS {
	provider ??= new GoogleTTS({
		voice: voiceForLanguage({}, listeningLanguage(), GOOGLE_VOICE),
		slow: GOOGLE_SLOW,
	});
	return provider;
}

export async function probeGoogleTts(): Promise<{ available: boolean; detail: string }> {
	// Keyless endpoint — availability is a network question answered at
	// synthesis time; the seam falls back if offline.
	return {
		available: true,
		detail: `online, no API key (voice ${voiceForLanguage({}, listeningLanguage(), GOOGLE_VOICE)})`,
	};
}

/**
 * Synthesize speech with Google's endpoint. Returns base64-encoded MP3.
 * Throws on failure — the TTS service (server/voice/tts/service.ts) handles
 * the fallback chain and provenance.
 */
export async function textToSpeechGoogleTts(text: string): Promise<string> {
	const normalizedText = text.trim();
	if (!normalizedText) return "";

	const audio = await getGoogle().toAudio(normalizedText, {
		lang: voiceForLanguage({}, listeningLanguage(), GOOGLE_VOICE),
	});
	if (!audio.data || audio.data.length === 0) {
		throw new Error("Google TTS produced no audio");
	}
	return audio.data.toString("base64");
}
