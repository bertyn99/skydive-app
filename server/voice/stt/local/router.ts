// Local STT router (the "whisper-local" engine). Two runners behind one
// seam, mirroring how Hex routes model families inside its own engine:
//
//   1. parakeet models → parakeet-cli (spawned per request; Parakeet TDT v3
//      is Hex's default class for en/es/fr and detects the language itself)
//   2. whisper models → whisper.cpp HTTP sidecar (persistent, language hint
//      from WHISPER_STT_LANGUAGE)
//
// The sidecar is auto-started on first use when a whisper model + binary are
// available, so installing a model from the dashboard is enough — no manual
// server start required.
//
// Config: see ../config (WHISPER_STT_URL, WHISPER_STT_LANGUAGE,
// WHISPER_STT_TIMEOUT_MS).
import { type EngineProbe } from "../../config";
import {
	bestInstalledModel,
	type WhisperModelSpec,
} from "./catalog";
import { probeParakeetBinary, transcribeParakeetLocal } from "./parakeet-cli";
import { startWhisperServer, whisperServerStatus } from "./whisper-sidecar";
import {
	WHISPER_STT_LANGUAGE,
	WHISPER_STT_TIMEOUT_MS,
	WHISPER_STT_URL,
} from "../../config";

/** Which local runner would handle the next transcription, and with what. */
export async function activeLocalRunner(): Promise<{
	runner: "parakeet-cli" | "whisper-server";
	modelId: string;
} | null> {
	const parakeet = await bestInstalledModel("parakeet");
	if (parakeet && (await probeParakeetBinary()).available) {
		return { runner: "parakeet-cli", modelId: parakeet.spec.id };
	}
	const whisper = await bestInstalledModel("whisper");
	if (whisper) return { runner: "whisper-server", modelId: whisper.spec.id };
	return null;
}

/**
 * Availability probe for the dashboard: the engine is ready when either
 * runner can work — a parakeet model is installed (CLI runner), or a
 * whisper model + binary exist for the sidecar (it auto-starts on first
 * use), or something is already answering at the configured URL.
 */
export async function probeWhisper(): Promise<EngineProbe> {
	const origin = new URL(WHISPER_STT_URL).origin;

	const parakeet = await bestInstalledModel("parakeet");
	if (parakeet) {
		const binary = await probeParakeetBinary();
		if (binary.available) {
			return { available: true, detail: `parakeet-cli on ${parakeet.spec.id} (language auto-detected)` };
		}
	}

	try {
		await fetch(origin, { method: "GET", signal: AbortSignal.timeout(800) });
		const status = await whisperServerStatus();
		const model = status.modelId ? ` on ${status.modelId}` : "";
		return { available: true, detail: `whisper-server responding at ${origin}${model}` };
	} catch {
		// Not running — but the sidecar auto-starts when a whisper model exists.
		const whisper = await bestInstalledModel("whisper");
		if (whisper) {
			return {
				available: true,
				detail: `whisper-server ready (${whisper.spec.id}) — auto-starts on first transcription`,
			};
		}
		return {
			available: false,
			detail: "no local model installed and no server answering",
			setupHint: "Use the whisper setup card below: install parakeet-v3 (recommended) or a whisper model.",
		};
	}
}

async function transcribeWithParakeet(
	audioBuffer: Buffer,
	mimeType: string,
	model: { spec: WhisperModelSpec },
): Promise<string> {
	const text = await transcribeParakeetLocal(audioBuffer, mimeType);
	console.log(`[stt] parakeet runner: ${model.spec.id}`);
	return text;
}

async function transcribeWithWhisperServer(
	audioBuffer: Buffer,
	mimeType: string,
): Promise<string> {
	// Auto-start the sidecar on first use (Hex: launch waits for the model).
	const status = await whisperServerStatus();
	if (!status.responding) {
		await startWhisperServer();
	}
	return transcribeViaHttp(audioBuffer, mimeType);
}

/**
 * Transcribe audio locally, routing to the best installed runner. Throws
 * when no local runner can work — the STT seam (server/voice/stt/service.ts) falls
 * back to the cloud engine and records provenance.
 */
export async function transcribeWhisperLocal(
	audioBuffer: Buffer,
	mimeType: string,
): Promise<string> {
	if (audioBuffer.length === 0) return "";

	// Parakeet first (Hex's default class for en/es/fr) — but only when its
	// CLI binary exists; otherwise fall through to the whisper sidecar, which
	// may be fully ready (installed model + built binary).
	const parakeet = await bestInstalledModel("parakeet");
	if (parakeet && (await probeParakeetBinary()).available) {
		return transcribeWithParakeet(audioBuffer, mimeType, parakeet);
	}

	const whisper = await bestInstalledModel("whisper");
	if (whisper) {
		return transcribeWithWhisperServer(audioBuffer, mimeType, whisper);
	}

	throw new Error(
		`no local STT runner available (install parakeet-v3 or a whisper model from the dashboard; nothing answering at ${WHISPER_STT_URL})`,
	);
}

/**
 * POST audio to the whisper.cpp sidecar as a multipart `file` field
 * (whisper.cpp /inference convention), JSON with a `text` field comes back.
 */
async function transcribeViaHttp(audioBuffer: Buffer, mimeType: string): Promise<string> {
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
