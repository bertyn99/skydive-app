// Mistral Voxtral TTS (cloud). Kept as a pure engine: the seam in
// server/utils/tts.ts owns the fallback chain and provenance.
const MISTRAL_TTS_MODEL_ID = process.env.MISTRAL_TTS_MODEL_ID ?? "voxtral-mini-tts-2603";
const MISTRAL_TTS_VOICE_ID = process.env.MISTRAL_TTS_VOICE_ID ?? "fr_marie_neutral";
const MISTRAL_TTS_TIMEOUT_MS = Number(process.env.MISTRAL_TTS_TIMEOUT_MS ?? 8000);

/**
 * Synthesize speech with Mistral and return base64-encoded MP3 audio.
 * Throws on missing key, HTTP error, timeout or malformed response —
 * the TTS seam (server/utils/tts.ts) handles the fallback chain.
 */
export async function textToSpeechMistral(text: string): Promise<string> {
	const apiKey = process.env.MISTRAL_API_KEY;
	if (!apiKey) {
		throw new Error("MISTRAL_API_KEY not set");
	}

	const normalizedText = text.trim();
	if (!normalizedText) return "";

	const response = await fetch("https://api.mistral.ai/v1/audio/speech", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			input: normalizedText,
			model: MISTRAL_TTS_MODEL_ID,
			voice_id: MISTRAL_TTS_VOICE_ID,
			response_format: "mp3",
		}),
		signal: AbortSignal.timeout(MISTRAL_TTS_TIMEOUT_MS),
	});

	if (!response.ok) {
		const errText = await response.text();
		throw new Error(
			`Mistral TTS error ${response.status}: ${errText.slice(0, 500)}`,
		);
	}

	const data = (await response.json()) as { audio_data?: string };
	if (!data.audio_data) {
		throw new Error("Mistral TTS response missing audio_data field");
	}
	return data.audio_data;
}
