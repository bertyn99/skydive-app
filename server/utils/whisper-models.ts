// Pinned speech-model catalog + Hugging Face installer, mirroring how
// anomalyco/hex manages its transcription models: every model is pinned to an
// exact file, byte size and SHA-256 (the HF LFS oid), downloads land in a
// local models folder as a `.partial` file under a download lock, are verified
// against the pin, then adopted with a receipt. Models already sitting in the
// Hugging Face hub cache ("found on this computer") are reused without a
// second download.
//
// The catalog adapts to the listening language and platform the way Hex does:
// Parakeet v3 (multilingual, detects the language itself) is the pick for our
// primary targets en/es/fr; system engines (Apple Speech) are listed on their
// platform only; whisper base stays as the low-RAM fallback.
//
// Config:
//   SKYDIVE_MODELS_DIR           models folder (default <repo>/.models; point
//                                it at the Electron userData dir later)
//   WHISPER_DOWNLOAD_TIMEOUT_MS  per-download timeout (default 15 min)
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { WHISPER_STT_LANGUAGE } from "./voice-config";

const MODELS_DIR = process.env.SKYDIVE_MODELS_DIR ?? path.resolve(process.cwd(), ".models");
const DOWNLOAD_TIMEOUT_MS = Number(process.env.WHISPER_DOWNLOAD_TIMEOUT_MS ?? 900_000);
const HF_BASE_URL = "https://huggingface.co";

// --- Pinned catalog (sizes + SHA-256 are the HF LFS oids, verified 2026-11) ---

export interface WhisperModelSpec {
	id: string;
	label: string;
	/** How the model runs: "ggml" (whisper.cpp sidecar) or "system" (OS engine). */
	kind: "ggml" | "system";
	/** Model family: whisper models run on the HTTP sidecar, parakeet via parakeet-cli. */
	arch: "whisper" | "parakeet";
	/** Platform the entry applies to; undefined = every platform. */
	platform?: "darwin" | "linux" | "win32";
	/** Hugging Face repo the file is pinned from (ggml models). */
	repo?: string;
	/** File name inside the repo (ggml models). */
	file?: string;
	sizeBytes?: number;
	sha256?: string;
	/** Languages covered, primary targets first. */
	languages: string[];
	/** Human summary of language coverage. */
	languagesNote: string;
	/** True when the model detects the spoken language itself (no hint needed) — Hex's "auto" class. */
	selfDetecting?: boolean;
	/** Disk size hint shown in the picker (ggml models). */
	diskNote: string;
	/** Estimated peak RAM once loaded (weights + compute state). */
	ramNote: string;
	/** Human one-liner shown in the model picker. */
	note: string;
	/** Ultimate low-RAM fallback when the language pick is not installed. */
	fallback?: boolean;
	/** What the Hex dictation app (anomalyco/hex) does with this model. */
	hexNote?: string;
}

export const WHISPER_MODELS: readonly WhisperModelSpec[] = [
	{
		id: "parakeet-v3",
		label: "Parakeet TDT 0.6B v3",
		kind: "ggml",
		arch: "parakeet",
		repo: "ggml-org/parakeet-GGUF",
		file: "ggml-parakeet-tdt-0.6b-v3-q8_0.bin",
		sizeBytes: 668_757_119,
		sha256: "4d64e9e96c2792186d072fde0034df0ad670cf680a2f53069052ead827fd600e",
		languages: ["en", "es", "fr", "de", "it", "pt", "nl"],
		languagesNote: "25 European languages, detects the language itself",
		selfDetecting: true,
		diskNote: "638 MB on disk",
		ramNote: "≈680 MB RAM (measured)",
		note: "Hex's default-class model: best accuracy-per-watt across en/es/fr.",
		hexNote: "the same checkpoint family Hex recommends and downloads on first run",
	},
	{
		id: "large-v3-turbo-q5_0",
		label: "Whisper large-v3-turbo (q5_0)",
		kind: "ggml",
		arch: "whisper",
		repo: "ggerganov/whisper.cpp",
		file: "ggml-large-v3-turbo-q5_0.bin",
		sizeBytes: 574_041_195,
		sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
		languages: ["en", "es", "fr"],
		languagesNote: "99 languages via a language hint",
		diskNote: "547 MB on disk",
		ramNote: "≈1.5 GB RAM (est.)",
		note: "Flagship accuracy, quantized to stay laptop-friendly.",
		hexNote: "the Whisper Hex ships — Hex's own default download is Parakeet v3",
	},
	{
		id: "apple-speech",
		label: "Apple Speech",
		kind: "system",
		arch: "whisper",
		platform: "darwin",
		languages: ["en", "es", "fr"],
		languagesNote: "system voices, locale follows the OS",
		diskNote: "no download",
		ramNote: "no extra RAM (OS-managed)",
		note: "macOS system recognizer — wired natively in the Electron shell.",
		hexNote: "Hex's macOS path: zero download, the OS does the listening",
	},
	{
		id: "base",
		label: "Whisper base",
		kind: "ggml",
		arch: "whisper",
		repo: "ggerganov/whisper.cpp",
		file: "ggml-base.bin",
		sizeBytes: 147_951_465,
		sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
		languages: ["en", "es", "fr"],
		languagesNote: "99 languages via a language hint",
		diskNote: "141 MB on disk",
		ramNote: "≈240 MB RAM (measured)",
		note: "Lite fallback: fastest on CPU, good for short radio calls.",
		fallback: true,
	},
] as const;

export function whisperModelById(id: string): WhisperModelSpec | undefined {
	return WHISPER_MODELS.find((spec) => spec.id === id);
}

export function modelsDir(): string {
	return MODELS_DIR;
}

/** The pinned HF files of a ggml-kind spec, or null for system engines. */
function ggmlFiles(spec: WhisperModelSpec): {
	repo: string;
	file: string;
	sizeBytes: number;
	sha256: string;
} | null {
	if (spec.kind !== "ggml" || !spec.repo || !spec.file || spec.sizeBytes === undefined || spec.sha256 === undefined) {
		return null;
	}
	return { repo: spec.repo, file: spec.file, sizeBytes: spec.sizeBytes, sha256: spec.sha256 };
}

/**
 * Hex adapts the recommended model to the listening language. For our
 * primary targets (en, es, fr) that is Parakeet v3 — multilingual,
 * self-detecting, best accuracy-per-watt — with whisper base as the
 * low-RAM fallback when it is not installed.
 */
export function recommendedModelIdForLanguage(language: string): string {
	const primary = ["en", "es", "fr"];
	const lang = language.slice(0, 2).toLowerCase();
	if (primary.includes(lang)) return "parakeet-v3";
	return "base";
}

/** The app's listening language (drives the per-language recommendation). */
export function listeningLanguage(): string {
	return WHISPER_STT_LANGUAGE;
}

// --- Status reports -----------------------------------------------------------

export type WhisperModelStatus =
	| "missing"
	| "partial"
	| "downloading"
	| "found"
	| "verified"
	| "corrupt"
	| "system";

export interface WhisperModelReport {
	spec: WhisperModelSpec;
	status: WhisperModelStatus;
	/** True when the entry applies to this platform (e.g. Apple Speech on macOS). */
	supported: boolean;
	/** Bytes received so far while downloading. */
	receivedBytes?: number;
	/** Absolute path of the verified local file (status `verified`). */
	filePath?: string;
	/** Absolute path of a usable copy found in the HF hub cache (status `found`). */
	foundPath?: string;
	/** Verification failure reason (status `corrupt`). */
	error?: string;
	/** Size of a stale `.partial` file (status `partial`). */
	partialBytes?: number;
}

interface ModelReceipt {
	file: string;
	sha256: string;
	sizeBytes: number;
	/** mtime the hash was computed over — rehash only when it moves. */
	mtimeMs: number;
	source: "download" | "found";
	/** Where a found copy lives (source `found`). */
	originPath?: string;
	verifiedAt: string;
}

export interface WhisperInstallState {
	modelId: string;
	status: "downloading" | "failed";
	receivedBytes: number;
	totalBytes: number;
	startedAt: number;
	error?: string;
}

let activeInstall: WhisperInstallState | null = null;
let lastInstallError: { modelId: string; error: string; at: number } | null = null;

export function whisperInstallState(): WhisperInstallState | null {
	return activeInstall;
}

export function whisperLastInstallError(): {
	modelId: string;
	error: string;
} | null {
	return lastInstallError ? { ...lastInstallError } : null;
}

// --- File helpers -------------------------------------------------------------

function localModelPath(file: string): string {
	return path.join(MODELS_DIR, file);
}

function partialPath(file: string): string {
	return `${localModelPath(file)}.partial`;
}

function receiptPath(file: string, source: "download" | "found"): string {
	return path.join(MODELS_DIR, `${file}.${source === "found" ? "found" : "verified"}.json`);
}

async function readReceipt(receiptFile: string): Promise<ModelReceipt | null> {
	try {
		const raw = await readFile(receiptFile, "utf8");
		return JSON.parse(raw) as ModelReceipt;
	} catch {
		return null;
	}
}

async function writeReceipt(
	files: { file: string; sizeBytes: number; sha256: string },
	source: "download" | "found",
	originPath?: string,
): Promise<void> {
	const target = source === "found" && originPath ? originPath : localModelPath(files.file);
	const s = await stat(target);
	const receipt: ModelReceipt = {
		file: files.file,
		sha256: files.sha256,
		sizeBytes: s.size,
		mtimeMs: s.mtimeMs,
		source,
		...(originPath ? { originPath } : {}),
		verifiedAt: new Date().toISOString(),
	};
	await writeFile(receiptPath(files.file, source), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

async function hashFile(filePath: string): Promise<string> {
	const hash = createHash("sha256");
	const stream = createReadStream(filePath);
	for await (const chunk of stream) {
		hash.update(chunk);
	}
	return hash.digest("hex");
}

/**
 * Verify a file against its pin. Receipt fast-path first: same size + mtime
 * as the last verified read means no rehash (Hex's rule). Otherwise hash once
 * and, on match, record a receipt so later checks stay cheap.
 */
async function verifyModelFile(
	files: { file: string; sizeBytes: number; sha256: string },
	filePath: string,
	source: "download" | "found",
): Promise<{ ok: true } | { ok: false; error: string }> {
	const s = await stat(filePath);
	if (s.size !== files.sizeBytes) {
		return { ok: false, error: `size ${s.size} ≠ pinned ${files.sizeBytes}` };
	}

	const receipt = await readReceipt(receiptPath(files.file, source));
	if (
		receipt &&
		receipt.sha256 === files.sha256 &&
		receipt.sizeBytes === s.size &&
		Math.abs(receipt.mtimeMs - s.mtimeMs) < 1
	) {
		return { ok: true };
	}

	const digest = await hashFile(filePath);
	if (digest !== files.sha256) {
		return { ok: false, error: `sha256 ${digest.slice(0, 12)}… ≠ pinned ${files.sha256.slice(0, 12)}…` };
	}
	await writeReceipt(files, source, source === "found" ? filePath : undefined);
	return { ok: true };
}

// --- "Found on this computer": scan the Hugging Face hub cache -----------------

function hfCacheRoots(): string[] {
	const roots: string[] = [];
	if (process.env.HF_HUB_CACHE) roots.push(process.env.HF_HUB_CACHE);
	if (process.env.HF_HOME) roots.push(path.join(process.env.HF_HOME, "hub"));
	if (process.env.HOME) roots.push(path.join(process.env.HOME, ".cache", "huggingface", "hub"));
	return [...new Set(roots)];
}

async function findInHfCache(repo: string, file: string, sizeBytes: number): Promise<string | null> {
	// HF hub layout: models--<owner>--<name>/snapshots/<revision>/<file>
	const repoDir = `models--${repo.replaceAll("/", "--")}`;
	for (const root of hfCacheRoots()) {
		const snapshotsDir = path.join(root, repoDir, "snapshots");
		const revisions = await readdir(snapshotsDir).catch(() => []);
		for (const revision of revisions) {
			const candidate = path.join(snapshotsDir, revision, file);
			const s = await stat(candidate).catch(() => null);
			if (s && s.size === sizeBytes) return candidate;
		}
	}
	return null;
}

// --- Status listing ------------------------------------------------------------

export async function listWhisperModels(): Promise<WhisperModelReport[]> {
	await mkdir(MODELS_DIR, { recursive: true });

	return Promise.all(
		WHISPER_MODELS.map(async (spec): Promise<WhisperModelReport> => {
			const supported = !spec.platform || spec.platform === process.platform;

			// System engines (Apple Speech) are OS-managed: nothing to install.
			if (spec.kind === "system") {
				return { spec, status: "system", supported };
			}
			if (!supported) {
				return { spec, status: "missing", supported };
			}

			const files = ggmlFiles(spec);
			if (!files) {
				return { spec, status: "missing", supported };
			}

			if (activeInstall?.modelId === spec.id && activeInstall.status === "downloading") {
				return { spec, status: "downloading", supported, receivedBytes: activeInstall.receivedBytes };
			}

			const local = localModelPath(files.file);
			const partial = partialPath(files.file);

			const partialStat = await stat(partial).catch(() => null);
			const localStat = await stat(local).catch(() => null);

			if (!localStat) {
				if (partialStat) {
					return { spec, status: "partial", supported, partialBytes: partialStat.size };
				}
				const foundPath = await findInHfCache(files.repo, files.file, files.sizeBytes);
				if (foundPath) return { spec, status: "found", supported, foundPath };
				return { spec, status: "missing", supported };
			}

			const verdict = await verifyModelFile(files, local, "download").catch((err: unknown) => ({
				ok: false as const,
				error: err instanceof Error ? err.message : String(err),
			}));
			if (verdict.ok) return { spec, status: "verified", supported, filePath: local };
			return { spec, status: "corrupt", supported, error: verdict.error };
		}),
	);
}

// --- Install (download + verify + adopt) ----------------------------------------

interface DownloadLock {
	modelId: string;
	pid: number;
	startedAt: string;
}

function lockPath(): string {
	return path.join(MODELS_DIR, ".download.lock");
}

async function acquireLock(file: string, modelId: string): Promise<void> {
	await mkdir(MODELS_DIR, { recursive: true });
	const existing = await readFile(lockPath(), "utf8").catch(() => null);
	if (existing) {
		const lock = JSON.parse(existing) as DownloadLock;
		if (lock.pid !== process.pid) {
			const holderAlive = await new Promise<boolean>((resolve) => {
				try {
					process.kill(lock.pid, 0);
					resolve(true);
				} catch {
					resolve(false);
				}
			});
			if (holderAlive) {
				throw new Error(
					`model ${file} is being downloaded by another process (pid ${lock.pid}) — download lock held`,
				);
			}
			// Stale lock from a dead process: take it over.
		}
	}
	const lock: DownloadLock = { modelId, pid: process.pid, startedAt: new Date().toISOString() };
	await writeFile(lockPath(), JSON.stringify(lock, null, 2), "utf8");
}

async function releaseLock(): Promise<void> {
	await rm(lockPath(), { force: true });
}

/**
 * Start installing a pinned model: downloads to `<file>.partial` under the
 * download lock, streams with progress, verifies the SHA-256 pin, renames into
 * place and writes a receipt. Resolves as soon as the download starts —
 * poll `listWhisperModels()` / `whisperInstallState()` for progress.
 */
export async function installWhisperModel(modelId: string): Promise<WhisperInstallState> {
	const spec = whisperModelById(modelId);
	if (!spec) {
		throw new Error(`unknown whisper model id "${modelId}" (known: ${WHISPER_MODELS.map((m) => m.id).join(", ")})`);
	}
	if (spec.kind === "system") {
		throw new Error(`"${spec.id}" is a system engine — nothing to download`);
	}
	const files = ggmlFiles(spec);
	if (!files) {
		throw new Error(`"${spec.id}" has no pinned file`);
	}
	if (activeInstall?.status === "downloading") {
		throw new Error(`download of "${activeInstall.modelId}" already in progress`);
	}

	// Already verified? Nothing to download (Hex: the card offers Use, never Download).
	const localStat = await stat(localModelPath(files.file)).catch(() => null);
	if (localStat) {
		const verdict = await verifyModelFile(files, localModelPath(files.file), "download");
		if (verdict.ok) {
			throw new Error(`"${spec.id}" is already installed and verified — no download needed`);
		}
	}

	await acquireLock(files.file, spec.id);

	const state: WhisperInstallState = {
		modelId: spec.id,
		status: "downloading",
		receivedBytes: 0,
		totalBytes: files.sizeBytes,
		startedAt: Date.now(),
	};
	activeInstall = state;

	// Fire and forget — the caller polls for progress.
	void runInstall(spec, files, state).catch(() => {
		// Errors are recorded on the state by runInstall itself.
	});

	return { ...state };
}

async function runInstall(
	spec: WhisperModelSpec,
	files: { repo: string; file: string; sizeBytes: number; sha256: string },
	state: WhisperInstallState,
): Promise<void> {
	const url = `${HF_BASE_URL}/${files.repo}/resolve/main/${files.file}`;
	const partial = partialPath(files.file);
	try {
		const response = await fetch(url, {
			redirect: "follow",
			signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
		});
		if (!response.ok) {
			throw new Error(`HF returned ${response.status} for ${url}`);
		}
		if (!response.body) {
			throw new Error("HF response has no body");
		}

		const hash = createHash("sha256");
		let received = 0;
		const out = createWriteStream(partial);
		const writeFailure = new Promise<never>((_, reject) => {
			out.once("error", reject);
		});

		const reader = response.body.getReader();
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				const data = Buffer.from(value);
				hash.update(data);
				received += data.length;
				state.receivedBytes = received;
				if (!out.write(data)) {
					await Promise.race([onceDrained(out), writeFailure]);
				}
			}
		} finally {
			reader.releaseLock();
		}
		await Promise.race([streamFinished(out), writeFailure]);

		const digest = hash.digest("hex");
		if (digest !== files.sha256) {
			throw new Error(`sha256 mismatch: got ${digest}, pin says ${files.sha256}`);
		}

		await rename(partial, localModelPath(files.file));
		await writeReceipt(files, "download");
		activeInstall = null;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		state.status = "failed";
		state.error = message;
		lastInstallError = { modelId: spec.id, error: message, at: Date.now() };
		activeInstall = null;
		await rm(partial, { force: true }).catch(() => {});
	} finally {
		await releaseLock().catch(() => {});
	}
}

function onceDrained(stream: import("node:fs").WriteStream): Promise<void> {
	return new Promise((resolve) => {
		stream.once("drain", () => resolve());
	});
}

function streamFinished(stream: import("node:fs").WriteStream): Promise<void> {
	return new Promise((resolve, reject) => {
		stream.end((err) => (err ? reject(err) : resolve()));
	});
}

// --- Remove ----------------------------------------------------------------------

/** Delete a local copy (file, partial and receipt). Found cache files are left alone. */
export async function removeWhisperModel(modelId: string): Promise<void> {
	const spec = whisperModelById(modelId);
	if (!spec) throw new Error(`unknown whisper model id "${modelId}"`);
	const files = ggmlFiles(spec);
	if (!files) throw new Error(`"${spec.id}" is a system engine — nothing to remove`);
	if (activeInstall?.modelId === spec.id && activeInstall.status === "downloading") {
		throw new Error(`"${spec.id}" is downloading — cancel it before removing`);
	}
	await rm(localModelPath(files.file), { force: true });
	await rm(partialPath(files.file), { force: true });
	await rm(receiptPath(files.file, "download"), { force: true });
	await rm(receiptPath(files.file, "found"), { force: true });
}

// --- Resolve a runnable model (used when starting the server) ---------------------

/**
 * Pick a model to run with, Hex-style: the requested one, else the language's
 * recommended pick (parakeet-v3 for en/es/fr), else the low-RAM fallback
 * (base), else any verified model, else a found HF-cache copy. System engines
 * (Apple Speech) are never resolved here — they need the native OS path.
 * `arch` restricts to a family (the whisper-server sidecar only loads
 * whisper models; parakeet runs through parakeet-cli).
 * Throws a status message naming what's missing.
 */
export async function resolveVerifiedModelPath(
	requestedId?: string,
	arch?: "whisper" | "parakeet",
): Promise<{ spec: WhisperModelSpec; path: string }> {
	const reports = await listWhisperModels();
	const eligible = arch ? reports.filter((report) => report.spec.arch === arch) : reports;
	const pick = (id?: string) => eligible.find((report) => report.spec.id === id);

	const requested = requestedId ? pick(requestedId) : undefined;
	if (requestedId && !requested) {
		throw new Error(
			arch
				? `whisper model "${requestedId}" is not installed or not a ${arch} model`
				: `unknown whisper model id "${requestedId}"`,
		);
	}
	if (requested?.spec.kind === "system") {
		throw new Error(
			`"${requested.spec.id}" is a system engine — it needs the native OS path (Electron phase), not the whisper-server sidecar`,
		);
	}

	const languagePick = pick(recommendedModelIdForLanguage(listeningLanguage()));
	const fallbackPick = eligible.find((report) => report.spec.fallback);
	const ordered = [
		...(requested ? [requested] : []),
		...(languagePick && languagePick !== requested ? [languagePick] : []),
		...(fallbackPick && fallbackPick !== requested && fallbackPick !== languagePick ? [fallbackPick] : []),
		...eligible.filter(
			(report) => report !== requested && report !== languagePick && report !== fallbackPick,
		),
	];

	for (const report of ordered) {
		if (report.status === "verified" && report.filePath) {
			return { spec: report.spec, path: report.filePath };
		}
	}
	for (const report of ordered) {
		if (report.status === "found" && report.foundPath) {
			const files = ggmlFiles(report.spec);
			if (!files) continue;
			const verdict = await verifyModelFile(files, report.foundPath, "found");
			if (verdict.ok) return { spec: report.spec, path: report.foundPath };
		}
	}

	const missing = eligible
		.map((report) => `${report.spec.id}: ${report.status}`)
		.join(", ");
	throw new Error(`no usable whisper model (install one from the dashboard) — ${missing}`);
}

/**
 * Best installed ggml model overall (language pick first, then fallback,
 * then anything verified), optionally restricted to a family. This decides
 * which local runner handles the next transcription: parakeet-v3 installed
 * → parakeet-cli (Hex's default class for en/es/fr); else the whisper-server
 * sidecar.
 */
export async function bestInstalledModel(
	arch?: "whisper" | "parakeet",
): Promise<{ spec: WhisperModelSpec; path: string } | null> {
	try {
		return await resolveVerifiedModelPath(undefined, arch);
	} catch {
		return null;
	}
}
