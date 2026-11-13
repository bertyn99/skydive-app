// macOS `say` TTS provider (darwin only). VoiPi's MacOS provider emits AIFF,
// which Chrome cannot decode — so we call the same system binary with a PCM
// WAV data format (`say --data-format=LEI16@22050 -o file.wav`), keeping the
// audio path browser-safe without an ffmpeg transcode. Zero download,
// instant, OS-managed voices — the TTS mirror of Hex's Apple Speech path.
//
// Config:
//   TTS_MACOS_VOICE        voice name (default: by listening language)
//   TTS_MACOS_TIMEOUT_MS   per-request timeout (default 8000)
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { voiceForLanguage } from "../../config";
import { spawnWorks } from "../../_spawn";

const MACOS_TTS_TIMEOUT_MS = Number(process.env.TTS_MACOS_TIMEOUT_MS ?? 8000);
const MACOS_VOICE = process.env.TTS_MACOS_VOICE;

// Classic macOS voices, listening language first.
const LANG_VOICES: Record<string, string> = {
	en: "Samantha",
	es: "Paulina",
	fr: "Thomas",
};

function voiceName(): string {
	return voiceForLanguage(LANG_VOICES, "Samantha", MACOS_VOICE);
}

export function isMacosSayPlatform(): boolean {
	return process.platform === "darwin";
}

export async function probeMacosSay(): Promise<{ available: boolean; detail: string }> {
	if (!isMacosSayPlatform()) {
		return { available: false, detail: "macOS only" };
	}
	const ok = await spawnWorks("say", ["-v", "?"]);
	return ok
		? { available: true, detail: `say on macOS, voice ${voiceName()}` }
		: { available: false, detail: "`say` not found on this macOS install" };
}

/**
 * Synthesize speech with the macOS system voice. Returns base64-encoded
 * 16-bit PCM WAV. Throws on timeout or failure — the TTS service
 * (server/voice/tts/service.ts) handles the fallback chain.
 */
export async function textToSpeechMacosSay(text: string): Promise<string> {
	const normalizedText = text.trim();
	if (!normalizedText) return "";

	const workDir = await mkdtemp(path.join(tmpdir(), "say-tts-"));
	const wavPath = path.join(workDir, "speech.wav");

	try {
		await new Promise<void>((resolve, reject) => {
			const child = spawn(
				"say",
				["-v", voiceName(), "--data-format=LEI16@22050", "-o", wavPath, normalizedText],
				{ stdio: ["ignore", "ignore", "pipe"] },
			);
			let stderr = "";
			const timer = setTimeout(() => {
				child.kill("SIGKILL");
				reject(new Error(`say timed out after ${MACOS_TTS_TIMEOUT_MS}ms`));
			}, MACOS_TTS_TIMEOUT_MS);
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});
			child.on("error", (err) => {
				clearTimeout(timer);
				reject(new Error(`say spawn failed: ${err.message}`));
			});
			child.on("close", (code) => {
				clearTimeout(timer);
				if (code === 0) resolve();
				else reject(new Error(`say exited with code ${code}: ${stderr.slice(0, 200)}`));
			});
		});

		const data = await readFile(wavPath);
		if (data.length === 0) {
			throw new Error("say produced no audio");
		}
		return data.toString("base64");
	} finally {
		await rm(workDir, { recursive: true, force: true }).catch(() => {});
	}
}
