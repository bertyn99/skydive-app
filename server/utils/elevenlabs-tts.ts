const VOICE_ID = "4p5WXd3ZuWR9pPtRQuxC";
const TTS_MODEL_ID = process.env.ELEVENLABS_TTS_MODEL_ID ?? "eleven_flash_v2_5";
const TTS_LANGUAGE_CODE = process.env.ELEVENLABS_TTS_LANGUAGE_CODE ?? "fr";
const TTS_OUTPUT_FORMAT = process.env.ELEVENLABS_TTS_OUTPUT_FORMAT ?? "mp3_44100_64";
const TTS_TIMEOUT_MS = Number(process.env.ELEVENLABS_TTS_TIMEOUT_MS ?? 8000);
const TTS_MAX_RETRIES = Number(process.env.ELEVENLABS_TTS_MAX_RETRIES ?? 1);
const TTS_CACHE_TTL_MS = Number(process.env.ELEVENLABS_TTS_CACHE_TTL_MS ?? 20000);
const TTS_CACHE_MAX_ENTRIES = Number(
	process.env.ELEVENLABS_TTS_CACHE_MAX_ENTRIES ?? 100,
);
const TTS_DEBUG_LOGS = process.env.ELEVENLABS_DEBUG === "1";

type CacheEntry = {
	audioBase64: string;
	expiresAt: number;
};

const ttsCache = new Map<string, CacheEntry>();
const inFlightByText = new Map<string, Promise<string>>();

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

function getCacheKey(text: string): string {
	return `${VOICE_ID}|${TTS_MODEL_ID}|${TTS_OUTPUT_FORMAT}|${text}`;
}

function getCachedAudio(cacheKey: string): string | null {
	const cached = ttsCache.get(cacheKey);
	if (!cached) return null;
	if (cached.expiresAt <= Date.now()) {
		ttsCache.delete(cacheKey);
		return null;
	}
	return cached.audioBase64;
}

function setCachedAudio(cacheKey: string, audioBase64: string): void {
	if (ttsCache.size >= TTS_CACHE_MAX_ENTRIES) {
		const oldestKey = ttsCache.keys().next().value;
		if (oldestKey) ttsCache.delete(oldestKey);
	}
	ttsCache.set(cacheKey, {
		audioBase64,
		expiresAt: Date.now() + TTS_CACHE_TTL_MS,
	});
}

export async function textToSpeechElevenLabs(text: string): Promise<string> {
	const apiKey = process.env.ELEVENLABS_API_KEY;
	if (!apiKey) {
		throw new Error("ELEVENLABS_API_KEY not set");
	}

	const normalizedText = text.trim();
	if (!normalizedText) return "";

	const cacheKey = getCacheKey(normalizedText);
	const cachedAudio = getCachedAudio(cacheKey);
	if (cachedAudio) {
		return cachedAudio;
	}

	const inFlight = inFlightByText.get(cacheKey);
	if (inFlight) {
		return inFlight;
	}

	const generationPromise = (async () => {
		let lastError: Error | null = null;
		const startedAt = Date.now();

		for (let attempt = 0; attempt <= TTS_MAX_RETRIES; attempt++) {
			try {
				const response = await fetch(
					`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=${encodeURIComponent(TTS_OUTPUT_FORMAT)}`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"xi-api-key": apiKey,
						},
						body: JSON.stringify({
							text: normalizedText,
							model_id: TTS_MODEL_ID,
							language_code: TTS_LANGUAGE_CODE,
							voice_settings: {
								stability: 0.5,
								similarity_boost: 0.75,
								speed: 1.05,
							},
						}),
						signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
					},
				);

				if (!response.ok) {
					const errText = await response.text();
					const retriable = shouldRetryStatus(response.status);
					const message = `ElevenLabs TTS error ${response.status}: ${errText.slice(0, 500)}`;
					if (retriable && attempt < TTS_MAX_RETRIES) {
						lastError = new Error(message);
						await sleep(getRetryDelayMs(attempt));
						continue;
					}
					throw new Error(message);
				}

				// Response is raw audio bytes — convert to base64.
				const arrayBuffer = await response.arrayBuffer();
				const base64 = Buffer.from(arrayBuffer).toString("base64");
				setCachedAudio(cacheKey, base64);

				if (TTS_DEBUG_LOGS) {
					const latencyMs = Date.now() - startedAt;
					console.log(
						`[elevenlabs-tts] ${Math.round(arrayBuffer.byteLength / 1024)}KB in ${latencyMs}ms`,
					);
				}
				return base64;
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				if (attempt < TTS_MAX_RETRIES && isRetriableError(err)) {
					await sleep(getRetryDelayMs(attempt));
					continue;
				}
			}
		}

		throw lastError ?? new Error("Unknown ElevenLabs TTS error");
	})();

	inFlightByText.set(cacheKey, generationPromise);
	try {
		return await generationPromise;
	} finally {
		inFlightByText.delete(cacheKey);
	}
}
