const VOICE_ID = "4p5WXd3ZuWR9pPtRQuxC";

export async function textToSpeechElevenLabs(text: string): Promise<string> {
	const apiKey = process.env.ELEVENLABS_API_KEY;
	if (!apiKey) {
		throw new Error("ELEVENLABS_API_KEY not set");
	}

	console.log(`[elevenlabs-tts] Sending request: "${text.slice(0, 80)}..."`);

	const response = await fetch(
		`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_64`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"xi-api-key": apiKey,
			},
			body: JSON.stringify({
				text,
				model_id: "eleven_flash_v2_5",
				language_code: "fr",
				voice_settings: {
					stability: 0.5,
					similarity_boost: 0.75,
					speed: 1.05,
				},
			}),
		},
	);

	if (!response.ok) {
		const errText = await response.text();
		console.error(`[elevenlabs-tts] Error ${response.status}:`, errText);
		throw new Error(`ElevenLabs TTS error ${response.status}: ${errText}`);
	}

	// Response is raw audio bytes — convert to base64
	const arrayBuffer = await response.arrayBuffer();
	const base64 = Buffer.from(arrayBuffer).toString("base64");

	console.log(
		`[elevenlabs-tts] Got ${(arrayBuffer.byteLength / 1024).toFixed(0)}KB audio`,
	);

	return base64;
}
