// Local Parakeet runner: whisper.cpp ships Parakeet as a CLI (parakeet-cli),
// not an HTTP server — upstream keeps the families separate, which is exactly
// why Hex rolled its own unified transcribe.cpp engine. We bridge the gap by
// spawning the CLI per request: audio is converted to 16 kHz mono WAV with
// ffmpeg (the CLI reads flac/mp3/ogg/wav but not the webm/opus the browser
// mic produces), the transcript comes back as plain text on stdout.
//
// Model: parakeet-v3 (ggml-org/parakeet-GGUF, q8_0) — multilingual TDT that
// detects the language itself, so no language hint is passed.
//
// Config:
//   WHISPER_PARAKEET_BINARY  CLI path (default .whisper.cpp/build/bin/parakeet-cli)
//   PARAKEET_TIMEOUT_MS      per-request timeout (default 20000; includes
//                            model load, which is mmap-fast)
import { spawn } from "node:child_process";
import { access, constants, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { bestInstalledModel } from "./catalog";

const PARAKEET_BINARY = process.env.WHISPER_PARAKEET_BINARY
	?? path.join(process.cwd(), ".whisper.cpp", "build", "bin", "parakeet-cli");
const PARAKEET_TIMEOUT_MS = Number(process.env.PARAKEET_TIMEOUT_MS ?? 20_000);

export interface ParakeetProbe {
	available: boolean;
	detail: string;
	setupHint?: string;
}

export async function probeParakeetBinary(): Promise<ParakeetProbe> {
	const ok = await access(PARAKEET_BINARY, constants.X_OK).then(() => true).catch(() => false);
	if (ok) {
		return { available: true, detail: `parakeet-cli: ${PARAKEET_BINARY}` };
	}
	return {
		available: false,
		detail: `parakeet-cli not found at ${PARAKEET_BINARY}`,
		setupHint: "Run `pnpm setup:whisper` (builds whisper-server and parakeet-cli).",
	};
}

/**
 * True when a parakeet model is installed — the runner for Hex's default
 * class (en/es/fr). The router in whisper-stt prefers it over the sidecar.
 */
export async function parakeetReady(): Promise<boolean> {
	const model = await bestInstalledModel("parakeet");
	return model !== null;
}

/**
 * Transcribe audio with the parakeet CLI. Returns the plain-text transcript
 * (stdout), or throws with the stderr tail on failure — the STT seam handles
 * fallback to the whisper-server sidecar.
 */
export async function transcribeParakeetLocal(
	audioBuffer: Buffer,
	mimeType: string,
): Promise<string> {
	if (audioBuffer.length === 0) return "";

	const model = await bestInstalledModel("parakeet");
	if (!model) {
		throw new Error("no parakeet model installed — install parakeet-v3 from the dashboard");
	}

	// The CLI reads wav (not webm/opus) — convert via ffmpeg into a temp dir.
	const workDir = await mkdtemp(path.join(tmpdir(), "parakeet-"));
	const inputPath = path.join(workDir, "input.raw");
	const wavPath = path.join(workDir, "input.wav");
	await writeFile(inputPath, audioBuffer);

	try {
		await convertToWav(inputPath, wavPath, mimeType);

		const startedAt = Date.now();
		const result = await new Promise<{ stdout: string; stderrTail: string[]; code: number | null }>((resolve, reject) => {
			const child = spawn(
				PARAKEET_BINARY,
				["--model", model.path, "--file", wavPath, "--no-prints"],
				{ stdio: ["ignore", "pipe", "pipe"] },
			);
			const stdout: Buffer[] = [];
			const stderrTail: string[] = [];
			let settled = false;

			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				child.kill("SIGKILL");
				reject(new Error(`parakeet-cli timed out after ${PARAKEET_TIMEOUT_MS}ms (${model.spec.id})`));
			}, PARAKEET_TIMEOUT_MS);

			child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
			child.stderr.on("data", (chunk: Buffer) => {
				stderrTail.push(chunk.toString().trimEnd());
				if (stderrTail.length > 6) stderrTail.splice(0, stderrTail.length - 6);
			});
			child.on("error", (err) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				const message = err.code === "ENOENT"
					? `parakeet-cli not found: ${PARAKEET_BINARY} (run pnpm setup:whisper)`
					: `parakeet-cli spawn failed: ${err.message}`;
				reject(new Error(message));
			});
			child.on("close", (code) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve({
					stdout: Buffer.concat(stdout).toString("utf8"),
					stderrTail,
					code,
				});
			});
		});

		if (result.code !== 0) {
			throw new Error(
				`parakeet-cli exited with code ${result.code}: ${result.stderrTail.slice(-2).join(" | ") || "no stderr"}`,
			);
		}

		const text = result.stdout.trim();
		if (!text) {
			throw new Error(
				`parakeet-cli produced no transcript: ${result.stderrTail.slice(-2).join(" | ") || "no stderr"}`,
			);
		}
		console.log(`[parakeet-stt] ${model.spec.id} in ${Date.now() - startedAt}ms`);
		return text;
	} finally {
		await rm(workDir, { recursive: true, force: true }).catch(() => {});
	}
}

function convertToWav(inputPath: string, wavPath: string, mimeType: string): Promise<void> {
	const ext = mimeType.includes("webm") ? "webm" : mimeType.includes("ogg") ? "ogg" : "wav";
	return new Promise((resolve, reject) => {
		const child = spawn("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", ext, "-i", inputPath, "-ar", "16000", "-ac", "1", wavPath], {
			stdio: ["ignore", "ignore", "pipe"],
		});
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error("ffmpeg conversion timed out"));
		}, 10_000);
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			const message = err.code === "ENOENT"
				? "ffmpeg not found — install it (the browser mic produces webm/opus)"
				: `ffmpeg spawn failed: ${err.message}`;
			reject(new Error(message));
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code === 0) resolve();
			else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(0, 200)}`));
		});
	});
}
