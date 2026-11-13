import { access, constants } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

// Piper is a local, offline TTS binary (https://github.com/rhasspy/piper).
// French voices ship as ONNX models (e.g. fr_FR-upmc-medium, fr_FR-tom-medium);
// expected latency on a laptop is ~100ms for a short sentence.
const PIPER_BINARY = process.env.PIPER_BINARY ?? "piper";
const PIPER_VOICE = process.env.PIPER_VOICE ?? "fr_FR-upmc-medium.onnx";
const PIPER_TIMEOUT_MS = Number(process.env.PIPER_TTS_TIMEOUT_MS ?? 5000);
const PIPER_DEBUG_LOGS = process.env.PIPER_DEBUG === "1";

export interface EngineProbe {
	available: boolean;
	detail: string;
	/** Setup steps shown in the dashboard when the engine is unavailable. */
	setupHint?: string;
}

async function isExecutable(filePath: string): Promise<boolean> {
	try {
		await access(filePath, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * Availability probe for the dashboard: is the piper binary resolvable, and
 * is the configured voice a real file (voice names are downloaded by piper
 * itself on first run, so a bare name is fine).
 */
export async function probePiper(): Promise<EngineProbe> {
	const bin = PIPER_BINARY;
	const voice = PIPER_VOICE;

	let binaryProbe: string;
	if (bin.includes("/") || bin.includes("\\")) {
		const ok = await isExecutable(bin);
		if (!ok) {
			return {
				available: false,
				detail: `binary not found at ${bin}`,
				setupHint: "Install piper, or point PIPER_BINARY at the binary.",
			};
		}
		binaryProbe = bin;
	} else {
		const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
		const names =
			process.platform === "win32" ? [`${bin}.exe`, `${bin}.cmd`, bin] : [bin];
		let found: string | null = null;
		for (const dir of dirs) {
			for (const name of names) {
				const candidate = path.join(dir, name);
				if (await isExecutable(candidate)) {
					found = candidate;
					break;
				}
			}
			if (found) break;
		}
		if (!found) {
			return {
				available: false,
				detail: `"${bin}" not found on PATH`,
				setupHint: "pip install piper-tts",
			};
		}
		binaryProbe = found;
	}

	const voiceDetail = voice.includes("/") || voice.includes("\\")
		? await (async () => {
			const ok = await access(voice, constants.R_OK).then(() => true).catch(() => false);
			return ok ? `voice: ${voice}` : `voice file missing: ${voice}`;
		})()
		: `voice: ${voice} (downloaded by piper on first run)`;

	return {
		available: true,
		detail: `binary: ${binaryProbe}, ${voiceDetail}`,
	};
}

/**
 * Synthesize speech with the local piper binary. Text goes in on stdin,
 * a complete WAV file comes out on stdout (`--output-file -`).
 * Throws when the binary is missing, times out, or exits non-zero —
 * the TTS seam (server/utils/tts.ts) handles the fallback chain.
 */
export async function textToSpeechPiperLocal(text: string): Promise<string> {
	const normalizedText = text.trim();
	if (!normalizedText) return "";

	const startedAt = Date.now();

	return new Promise<string>((resolve, reject) => {
		const child = spawn(
			PIPER_BINARY,
			["--model", PIPER_VOICE, "--output-file", "-"],
			{
				stdio: ["pipe", "pipe", "pipe"],
			},
		);

		const stdout: Buffer[] = [];
		let stderr = "";
		let settled = false;

		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			child.kill("SIGKILL");
			reject(
				new Error(
					`Piper TTS timed out after ${PIPER_TIMEOUT_MS}ms (${PIPER_BINARY}, voice ${PIPER_VOICE})`,
				),
			);
		}, PIPER_TIMEOUT_MS);

		child.stdout.on("data", (chunk: Buffer) => {
			stdout.push(chunk);
		});

		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		child.on("error", (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			// ENOENT = binary not installed — the most common failure mode.
			const message =
				err.code === "ENOENT"
					? `Piper binary not found: ${PIPER_BINARY} (install piper or set PIPER_BINARY)`
					: `Piper spawn failed: ${err.message}`;
			reject(new Error(message));
		});

		child.on("close", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);

			const audio = Buffer.concat(stdout);
			if (code !== 0) {
				reject(
					new Error(
						`Piper exited with code ${code}: ${stderr.slice(0, 300) || "no stderr"}`,
					),
				);
				return;
			}
			if (audio.length === 0) {
				reject(new Error(`Piper produced no audio: ${stderr.slice(0, 300)}`));
				return;
			}

			if (PIPER_DEBUG_LOGS) {
				console.log(
					`[piper-tts] ${Math.round(audio.length / 1024)}KB wav in ${Date.now() - startedAt}ms`,
				);
			}
			resolve(audio.toString("base64"));
		});

		child.stdin.on("error", () => {
			// EPIPE if piper dies early — the close/error handlers reject.
		});
		child.stdin.end(`${normalizedText}\n`);
	});
}
