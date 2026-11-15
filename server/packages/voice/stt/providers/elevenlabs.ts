const STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";
const STT_MODEL_ID = process.env.ELEVENLABS_STT_MODEL_ID ?? "scribe_v2";
const STT_LANGUAGE_CODE = process.env.ELEVENLABS_STT_LANGUAGE_CODE ?? "fr";
const STT_TIMEOUT_MS = Number(process.env.ELEVENLABS_STT_TIMEOUT_MS ?? 8000);
const STT_MAX_RETRIES = Number(process.env.ELEVENLABS_STT_MAX_RETRIES ?? 1);
const STT_DEBUG_LOGS = process.env.ELEVENLABS_DEBUG === "1";

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryStatus(status: number): boolean {
	return status === 408 || status === 429 || status >= 500;
}

function getRetryDelayMs(attempt: number): number {
	return 150 * 2 ** attempt;
}

function isRetriableError(error: unknown): boolean {
	if (error instanceof DOMException) {
		return error.name === "TimeoutError" || error.name === "AbortError";
	}
	return error instanceof TypeError;
}

export async function transcribeAudio(
	audioBuffer: Buffer,
	mimeType: string,
): Promise<string> {
	const apiKey = process.env.ELEVENLABS_API_KEY;
	if (!apiKey) {
		throw new Error("ELEVENLABS_API_KEY not set");
	}
	if (audioBuffer.length === 0) {
		return "";
	}

	// Determine file extension from mimeType
	const ext = mimeType.includes("webm") ? "webm" : "ogg";

	let lastError: Error | null = null;
	const startedAt = Date.now();

	for (let attempt = 0; attempt <= STT_MAX_RETRIES; attempt++) {
		try {
			const formData = new FormData();
			formData.append("model_id", STT_MODEL_ID);
			formData.append("language_code", STT_LANGUAGE_CODE);
			formData.append(
				"file",
				new Blob([new Uint8Array(audioBuffer)], { type: mimeType }),
				`audio.${ext}`,
			);
			formData.append("tag_audio_events", "false");

			const response = await fetch(STT_URL, {
				method: "POST",
				headers: {
					"xi-api-key": apiKey,
				},
				body: formData,
				signal: AbortSignal.timeout(STT_TIMEOUT_MS),
			});

			if (!response.ok) {
				const errText = await response.text();
				const retriable = shouldRetryStatus(response.status);
				const message = `ElevenLabs STT error ${response.status}: ${errText.slice(0, 500)}`;

				if (retriable && attempt < STT_MAX_RETRIES) {
					lastError = new Error(message);
					await sleep(getRetryDelayMs(attempt));
					continue;
				}

				throw new Error(message);
			}

			const data = (await response.json()) as { text?: string };

			if (typeof data.text !== "string") {
				throw new Error("ElevenLabs STT response missing text field");
			}

			if (STT_DEBUG_LOGS) {
				const latencyMs = Date.now() - startedAt;
				console.log(
					`[elevenlabs-stt] ${Math.round(audioBuffer.length / 1024)}KB -> ${latencyMs}ms`,
				);
			}
			return data.text;
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			if (attempt < STT_MAX_RETRIES && isRetriableError(err)) {
				await sleep(getRetryDelayMs(attempt));
				continue;
			}
		}
	}

	throw lastError ?? new Error("Unknown ElevenLabs STT error");
}
