export async function textToSpeech(text: string): Promise<string> {
	const apiKey = process.env.MISTRAL_API_KEY;
	if (!apiKey) {
		throw new Error("MISTRAL_API_KEY not set");
	}

	const response = await fetch("https://api.mistral.ai/v1/audio/speech", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model: "mistral-tts-latest",
			input: text,
			response_format: "mp3",
		}),
	});

	if (!response.ok) {
		const errText = await response.text();
		throw new Error(`Mistral TTS error ${response.status}: ${errText}`);
	}

	const data = (await response.json()) as { audio_data: string };
	return data.audio_data;
}
