// Whisper.cpp sidecar manager: resolves a locally built `whisper-server`
// binary, spawns it against a verified model, and waits for it to answer.
// This is the web-app stand-in for what Hex does in-process (it embeds its
// own transcribe.cpp engine) — same local-first contract: after the binary
// and model are on disk, audio never leaves the machine.
//
// Binary resolution order:
//   1. WHISPER_SERVER_BINARY env (absolute path)
//   2. .whisper.cpp/build/bin/whisper-server (created by scripts/setup-whisper.sh)
//
// The server runs with --convert because the browser mic capture is
// webm/opus (src/utils/voice.ts) and whisper.cpp only decodes WAV natively;
// --convert shells out to ffmpeg, so ffmpeg must be on PATH.
import { spawn, type ChildProcess } from "node:child_process";
import { access, constants } from "node:fs/promises";
import path from "node:path";
import { spawnWorks } from "../../_spawn";
import { resolveVerifiedModelPath } from "./catalog";
import { WHISPER_STT_URL } from "../../config";

const START_TIMEOUT_MS = Number(process.env.WHISPER_SERVER_START_TIMEOUT_MS ?? 30_000);
const REPO_ROOT = process.cwd();
const BUNDLED_BINARY = path.join(REPO_ROOT, ".whisper.cpp", "build", "bin", "whisper-server");

function serverPort(): number {
	try {
		const url = new URL(WHISPER_STT_URL);
		return url.port ? Number(url.port) : 80;
	} catch {
		return 8080;
	}
}

function serverOrigin(): string {
	try {
		return new URL(WHISPER_STT_URL).origin;
	} catch {
		return `http://127.0.0.1:${serverPort()}`;
	}
}

// --- Probes ---------------------------------------------------------------------

export interface WhisperBinaryProbe {
	available: boolean;
	path?: string;
	detail: string;
	setupHint?: string;
}

export async function resolveWhisperServerBinary(): Promise<WhisperBinaryProbe> {
	const candidates = process.env.WHISPER_SERVER_BINARY
		? [process.env.WHISPER_SERVER_BINARY]
		: [BUNDLED_BINARY];

	for (const candidate of candidates) {
		const ok = await access(candidate, constants.X_OK).then(() => true).catch(() => false);
		if (ok) {
			return { available: true, path: candidate, detail: `binary: ${candidate}` };
		}
	}

	return {
		available: false,
		detail: `no whisper-server binary (${candidates.join(", ")})`,
		setupHint: "Run `bash scripts/setup-whisper.sh` (builds whisper.cpp at a pinned tag), or set WHISPER_SERVER_BINARY.",
	};
}

/** whisper.cpp needs ffmpeg for --convert (mic capture is webm/opus). */
export interface FfmpegProbe {
	available: boolean;
	/** Absolute path when found outside PATH (the sidecar needs it on its PATH). */
	path?: string;
	detail: string;
}

const FFMPEG_FALLBACKS = [
	`${process.env.HOME ?? ""}/.local/bin/ffmpeg`,
	"/usr/local/bin/ffmpeg",
	"/usr/bin/ffmpeg",
];

export async function probeFfmpeg(): Promise<FfmpegProbe> {
	if (await spawnWorks("ffmpeg", ["-version"])) {
		return { available: true, detail: "ffmpeg on PATH (webm→wav conversion OK)" };
	}
	for (const candidate of FFMPEG_FALLBACKS) {
		if (candidate.startsWith("${")) continue; // HOME unset
		if (await spawnWorks(candidate, ["-version"])) {
			return {
				available: true,
				path: candidate,
				detail: `ffmpeg at ${candidate} (not on the server's PATH — the sidecar gets it injected)`,
			};
		}
	}
	return {
		available: false,
		detail: "ffmpeg missing — whisper-server needs it to decode webm/opus mic capture",
	};
}

// --- Server lifecycle -------------------------------------------------------------

interface WhisperServerHandle {
	child: ChildProcess;
	modelId: string;
	modelPath: string;
	port: number;
	startedAt: number;
	stderrTail: string[];
}

interface ServerExitInfo {
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	stderrTail: string[];
}

let handle: WhisperServerHandle | null = null;
let lastExit: ServerExitInfo | null = null;

export interface WhisperServerStatus {
	running: boolean;
	/** True when something answers at the configured URL (ours or external). */
	responding: boolean;
	pid?: number;
	modelId?: string;
	port: number;
	detail: string;
	lastExit?: ServerExitInfo;
}

async function serverResponding(timeoutMs = 500): Promise<boolean> {
	try {
		await fetch(serverOrigin(), { signal: AbortSignal.timeout(timeoutMs) });
		return true;
	} catch {
		return false;
	}
}

export async function whisperServerStatus(): Promise<WhisperServerStatus> {
	const port = serverPort();
	const responding = await serverResponding();
	if (handle && handle.child.exitCode === null) {
		return {
			running: true,
			responding,
			pid: handle.child.pid,
			modelId: handle.modelId,
			port,
			detail: `whisper-server on ${handle.modelId} (pid ${handle.child.pid}, port ${port})`,
		};
	}
	const detail = responding
		? `a server already answers at ${serverOrigin()} (started outside this app)`
		: lastExit
			? `not running (last exit: code ${lastExit.exitCode ?? `signal ${lastExit.signal ?? "?"}`})`
			: `not running (nothing at ${serverOrigin()})`;
	return { running: false, responding, port, detail, ...(lastExit ? { lastExit } : {}) };
}

export async function startWhisperServer(requestedModelId?: string): Promise<WhisperServerStatus> {
	const current = await whisperServerStatus();
	if (current.running) return current;
	if (current.responding) {
		// Something else already serves this port — adopt it instead of spawning
		// a duplicate (Hex reuses what it finds on the machine the same way).
		return current;
	}

	const binary = await resolveWhisperServerBinary();
	if (!binary.available) {
		throw new Error(binary.setupHint ?? "whisper-server binary not found");
	}

	const { spec, path: modelPath } = await resolveVerifiedModelPath(requestedModelId, "whisper");
	const port = serverPort();

	// whisper-server's --convert shells out to `ffmpeg`; when ffmpeg only
	// exists at a fallback path, prepend its directory to the child's PATH.
	const ffmpeg = await probeFfmpeg();
	const childEnv = ffmpeg.path
		? {
				...process.env,
				PATH: `${path.dirname(ffmpeg.path)}${path.delimiter}${process.env.PATH ?? ""}`,
			}
		: process.env;

	const child = spawn(
		binary.path ?? BUNDLED_BINARY,
		["--model", modelPath, "--port", String(port), "--host", "127.0.0.1", "--inference-path", "/inference", "--convert"],
		{ stdio: ["ignore", "ignore", "pipe"], env: childEnv },
	);

	const pending: WhisperServerHandle = {
		child,
		modelId: spec.id,
		modelPath,
		port,
		startedAt: Date.now(),
		stderrTail: [],
	};
	child.stderr?.on("data", (chunk: Buffer) => {
		const lines = chunk.toString().split("\n").filter(Boolean);
		pending.stderrTail.push(...lines);
		if (pending.stderrTail.length > 20) pending.stderrTail.splice(0, pending.stderrTail.length - 20);
	});

	child.once("exit", (code, signal) => {
		if (handle === pending) handle = null;
		lastExit = { exitCode: code, signal, stderrTail: [...pending.stderrTail] };
		if (code !== 0 && code !== null) {
			console.warn(`[whisper-server] exited with code ${code}: ${pending.stderrTail.slice(-3).join(" | ")}`);
		}
	});
	handle = pending;

	// Wait for the model to load and the HTTP listener to come up.
	const deadline = Date.now() + START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			handle = null;
			throw new Error(
				`whisper-server exited during startup (code ${child.exitCode}): ${pending.stderrTail.slice(-3).join(" | ") || "no stderr"}`,
			);
		}
		if (await serverResponding(400)) {
			lastExit = null;
			return whisperServerStatus();
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	await stopWhisperServer();
	throw new Error(
		`whisper-server did not answer within ${START_TIMEOUT_MS}ms (model ${spec.id}) — check ffmpeg (--convert) and the model file`,
	);
}

export async function stopWhisperServer(): Promise<WhisperServerStatus> {
	if (!handle || handle.child.exitCode !== null) {
		return whisperServerStatus();
	}
	const child = handle.child;
	await new Promise<void>((resolve) => {
		child.once("exit", () => resolve());
		child.kill("SIGTERM");
		setTimeout(() => {
			if (child.exitCode === null) child.kill("SIGKILL");
			resolve();
		}, 2000).unref();
	});
	return whisperServerStatus();
}

// If the Nitro process exits cleanly, take the sidecar down with it.
process.once("exit", () => {
	if (handle?.child.pid && handle.child.exitCode === null) {
		try {
			process.kill(handle.child.pid, "SIGTERM");
		} catch {
			// Already gone.
		}
	}
});
