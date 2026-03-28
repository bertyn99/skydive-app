export async function transcribeAudio(
	audioBuffer: Buffer,
	mimeType: string,
): Promise<string> {
	const apiKey = process.env.ELEVENLABS_API_KEY;
	if (!apiKey) {
		throw new Error("ELEVENLABS_API_KEY not set");
	}

	// Determine file extension from mimeType
	const ext = mimeType.includes("webm") ? "webm" : "ogg";

	const formData = new FormData();
	formData.append("model_id", "scribe_v2");
	formData.append("language_code", "fr");
	formData.append(
		"file",
		new Blob([audioBuffer], { type: mimeType }),
		`audio.${ext}`,
	);
	formData.append("tag_audio_events", "false");

	console.log(
		`[elevenlabs-stt] Transcribing ${(audioBuffer.length / 1024).toFixed(0)}KB audio`,
	);

	const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
		method: "POST",
		headers: {
			"xi-api-key": apiKey,
		},
		body: formData,
	});

	if (!response.ok) {
		const errText = await response.text();
		console.error(`[elevenlabs-stt] Error ${response.status}:`, errText);
		throw new Error(`ElevenLabs STT error ${response.status}: ${errText}`);
	}

	const data = (await response.json()) as { text?: string };

	if (typeof data.text !== "string") {
		throw new Error("ElevenLabs STT response missing text field");
	}

	console.log(`[elevenlabs-stt] Transcript: "${data.text}"`);
	return data.text;
}
