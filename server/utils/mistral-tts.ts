export async function textToSpeech(text: string): Promise<string> {
	const apiKey = process.env.MISTRAL_API_KEY;
	if (!apiKey) {
		throw new Error("MISTRAL_API_KEY not set");
	}

	const body = {
		input: text,
		model: null,
		response_format: "mp3",
	};

	console.log(
		"[mistral-tts] Sending request:",
		JSON.stringify({ ...body, input: body.input.slice(0, 80) + "..." }),
	);

	const response = await fetch("https://api.mistral.ai/v1/audio/speech", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const errText = await response.text();
		console.error(`[mistral-tts] Error ${response.status}:`, errText);
		throw new Error(`Mistral TTS error ${response.status}: ${errText}`);
	}

	const data = (await response.json()) as { audio_data?: string };

	if (!data.audio_data) {
		console.error(
			"[mistral-tts] Response missing audio_data:",
			JSON.stringify(data).slice(0, 200),
		);
		throw new Error("Mistral TTS response missing audio_data field");
	}

	return data.audio_data;
}
