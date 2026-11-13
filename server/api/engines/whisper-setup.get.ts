import { defineEventHandler } from "h3";
import { probeFfmpeg, resolveWhisperServerBinary, whisperServerStatus } from "../../voice";
import { activeLocalRunner } from "../../voice";
import {
	listWhisperModels,
	listeningLanguage,
	modelsDir,
	recommendedModelIdForLanguage,
	whisperInstallState,
	whisperLastInstallError,
	type WhisperInstallState,
	type WhisperModelReport,
} from "../../voice";

export interface WhisperBinaryPayload {
	available: boolean;
	path?: string;
	detail: string;
	setupHint?: string;
}

export interface WhisperServerPayload {
	running: boolean;
	responding: boolean;
	pid?: number;
	modelId?: string;
	port: number;
	detail: string;
}

export interface WhisperSetupPayload {
	modelsDir: string;
	/** The machine running the Nitro server — gates platform-only engines (Apple Speech). */
	platform: "darwin" | "linux" | "win32" | string;
	/** The listening language (WHISPER_STT_LANGUAGE, default fr). */
	language: string;
	/** Which model the language pick recommends right now (Hex adapts this per language). */
	recommendedId: string;
	/** The runner that would handle the next transcription and its model. */
	activeRunner: { runner: "parakeet-cli" | "whisper-server"; modelId: string } | null;
	binary: WhisperBinaryPayload;
	ffmpeg: { available: boolean; detail: string };
	server: WhisperServerPayload;
	models: WhisperModelReport[];
	install: WhisperInstallState | null;
	lastInstallError: { modelId: string; error: string } | null;
}

/**
 * Whisper local setup status: binary, ffmpeg, sidecar server, pinned model
 * catalog with install state. Poll this while a download or startup is
 * running (the dashboard refreshes it every second when busy).
 */
export default defineEventHandler(async (): Promise<WhisperSetupPayload> => {
	const [binary, ffmpeg, server, models, runner] = await Promise.all([
		resolveWhisperServerBinary(),
		probeFfmpeg(),
		whisperServerStatus(),
		listWhisperModels(),
		activeLocalRunner(),
	]);

	const install = whisperInstallState();

	return {
		modelsDir: modelsDir(),
		platform: process.platform,
		language: listeningLanguage(),
		recommendedId: recommendedModelIdForLanguage(listeningLanguage()),
		activeRunner: runner,
		binary,
		ffmpeg,
		server: {
			running: server.running,
			responding: server.responding,
			pid: server.pid,
			modelId: server.modelId,
			port: server.port,
			detail: server.detail,
		},
		models,
		install,
		lastInstallError: whisperLastInstallError(),
	};
});
