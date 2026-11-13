// Local STT via a whisper.cpp server (`server -m ggml-base.bin --port 8080`)
// or any compatible faster-whisper HTTP server. French by default; runs on
// the same machine as the Nitro server, no cloud round-trip.
//
// Config:
//   WHISPER_STT_URL        inference endpoint (default http://127.0.0.1:8080/inference)
//   WHISPER_STT_LANGUAGE   language code (default fr)
//   WHISPER_STT_TIMEOUT_MS per-request timeout (default 8000)
const WHISPER_STT_URL = process.env.WHISPER_STT_URL ?? "http://127.0.0.1:8080/inference";
const WHISPER_STT_LANGUAGE = process.env.WHISPER_STT_LANGUAGE ?? "fr";
const WHISPER_STT_TIMEOUT_MS = Number(process.env.WHISPER_STT_TIMEOUT_MS ?? 8000);

/**
 * Availability probe for the dashboard: is anything answering at the
 * configured whisper URL? Any HTTP response counts (the server 404s on GET),
 * only connection failures mean "not installed / not running".
 */
export async function probeWhisper(): Promise<EngineProbe> {
	const origin = new URL(WHISPER_STT_URL).origin;
	try {
		await fetch(origin, {
			method: "GET",
			signal: AbortSignal.timeout(800),
		});
		return { available: true, detail: `server responding at ${origin}` };
	} catch {
		return {
			available: false,
			detail: `no server at ${origin}`,
			setupHint: "Build and start the whisper.cpp server (see setup below the STT engine).",
		};
	}
}

/**
 * Transcribe audio with the local whisper server. Audio goes up as a
 * multipart `file` field (whisper.cpp /inference convention), JSON with a
 * `text` field comes back. Throws on connection failure, timeout or a
 * malformed response — the STT seam (server/utils/stt.ts) handles the
 * fallback chain and provenance.
 */
export async function transcribeWhisperLocal(
	audioBuffer: Buffer,
	mimeType: string,
): Promise<string> {
	if (audioBuffer.length === 0) return "";

	const ext = mimeType.includes("webm") ? "webm" : mimeType.includes("ogg") ? "ogg" : "wav";
	const formData = new FormData();
	formData.append(
		"file",
		new Blob([new Uint8Array(audioBuffer)], { type: mimeType }),
		`audio.${ext}`,
	);
	formData.append("response_format", "json");
	formData.append("language", WHISPER_STT_LANGUAGE);
	formData.append("temperature", "0");

	let response: Response;
	try {
		response = await fetch(WHISPER_STT_URL, {
			method: "POST",
			body: formData,
			signal: AbortSignal.timeout(WHISPER_STT_TIMEOUT_MS),
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(
			`Whisper server unreachable at ${WHISPER_STT_URL}: ${message}`,
			{ cause: err },
		);
	}

	if (!response.ok) {
		const errText = await response.text();
		throw new Error(
			`Whisper STT error ${response.status}: ${errText.slice(0, 500)}`,
		);
	}

	const data = (await response.json()) as { text?: unknown };
	if (typeof data.text !== "string") {
		throw new Error("Whisper STT response missing text field");
	}
	return data.text;
}
