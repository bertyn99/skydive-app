export async function textToSpeech(text: string): Promise<string> {
	const apiKey = process.env.MISTRAL_API_KEY;
	if (!apiKey) {
		throw new Error("MISTRAL_API_KEY not set");
	}

	const body = {
		input: text,
		model: "voxtral-mini-tts-2603",
		voice_id: "fr_marie_neutral",
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

	// Save audio to file for debugging
	// const fs = await import("fs/promises");
	// const path = await import("path");
	// const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	// const debugPath = path.join(process.cwd(), `debug-audio-${timestamp}.mp3`);
	// await fs.writeFile(debugPath, Buffer.from(data.audio_data, "base64"));
	// console.log(`[mistral-tts] Audio saved to: ${debugPath}`);

	return data.audio_data;
}
