#!/usr/bin/env node
/**
 * fetch-letsplays.ts — download Skyrim lets-play source videos for the Sim
 * session (glossary: Simulation session). Videos land in `media/letsplays/`,
 * which is gitignored: multi-hour files never enter git. On a fresh machine,
 * run `pnpm fetch:letsplays` to rebuild the local dev corpus.
 *
 * Requirements: Node >= 23.6 (native TS type stripping) and yt-dlp.
 * No ffmpeg needed: yt-dlp grabs a single muxed stream and time-range
 * slicing is done in-process with mediabunny (the app's own media engine).
 *   yt-dlp: https://github.com/yt-dlp/yt-dlp#installation
 *   pipx install yt-dlp  |  brew install yt-dlp  |  winget install yt-dlp
 *
 * Usage:
 *   pnpm fetch:letsplays                       download every curated video
 *   pnpm fetch:letsplays --list                show the curated list
 *   pnpm fetch:letsplays --id <id|url>         download one specific video
 *   pnpm fetch:letsplays --search "<query>"    search YouTube, download top results
 *   pnpm fetch:letsplays --max 3               cap search results (default 3)
 *   pnpm fetch:letsplays --height 720          cap resolution (default 720, muxed formats only)
 *   pnpm fetch:letsplays --section 12:00-14:00 also slice this range into a small clip
 *   pnpm fetch:letsplays --dry-run             print the yt-dlp commands, run nothing
 *
 * For personal development and testing use only.
 */

import { spawn, spawnSync } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
	ALL_FORMATS,
	BufferTarget,
	Conversion,
	Input,
	Mp4OutputFormat,
	Output,
	FilePathSource,
} from "mediabunny";

const OUTPUT_DIR = "media/letsplays";

interface CuratedVideo {
	id: string;
	title: string;
	channel: string;
}

interface FetchArgs {
	ids: string[];
	search: string | null;
	max: number;
	height: number;
	section: string | null;
	dryRun: boolean;
	list: boolean;
}

interface SectionRange {
	fromSeconds: number;
	toSeconds: number;
}

const CURATED: CuratedVideo[] = [
	{
		id: "QWoF8S_F3Bo",
		title: "SKYRIM Gameplay Walkthrough FULL GAME [4K 60FPS PC ULTRA] - No Commentary",
		channel: "full gameplay walkthroughs",
	},
	{
		id: "nr62-GnrrOs",
		title: "Skyrim - Longplay Main Quest Full Game Walkthrough (No Commentary)",
		channel: "longplay channel",
	},
	{
		id: "p0I7ccItmv8",
		title: "Skyrim - Longplay Main Quest Full Game Walkthrough [No Commentary]",
		channel: "Loopy Longplays",
	},
	{
		id: "0QijB8ep_2E",
		title: "The Elder Scrolls V: Skyrim - Full Game (no commentary playthrough)",
		channel: "no-commentary playthrough",
	},
	{
		id: "-Hnr9hZ-vvM",
		title: "SKYRIM Gameplay Walkthrough Full Game Story - No Commentary (4K 60 FPS)",
		channel: "NRMwalkthroughHD",
	},
];

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function parseArgs(argv: string[]): FetchArgs {
	const args: FetchArgs = {
		ids: [],
		search: null,
		max: 3,
		height: 720,
		section: null,
		dryRun: false,
		list: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		switch (arg) {
			case "--id":
				args.ids.push(argv[++i] ?? "");
				break;
			case "--search":
				args.search = argv[++i] ?? null;
				break;
			case "--max":
				args.max = Number(argv[++i]);
				break;
			case "--height":
				args.height = Number(argv[++i]);
				break;
			case "--section":
				args.section = argv[++i] ?? null;
				break;
			case "--dry-run":
				args.dryRun = true;
				break;
			case "--list":
				args.list = true;
				break;
			default:
				if (arg.startsWith("http") || VIDEO_ID_RE.test(arg)) {
					args.ids.push(arg);
				} else {
					console.error(`Unknown argument: ${arg}`);
					process.exit(1);
				}
		}
	}
	return args;
}

function requireYtDlp(): void {
	const probe = spawnSync("yt-dlp", ["--version"], { encoding: "utf8" });
	if (probe.error || probe.status !== 0) {
		console.error(
			"yt-dlp is required but not installed or not on PATH.\n" +
				"Install it, then re-run:\n" +
				"  pipx install yt-dlp        (or: pip install yt-dlp)\n" +
				"  brew install yt-dlp        (macOS)\n" +
				"  winget install yt-dlp.yt-dlp   (Windows)\n" +
				"https://github.com/yt-dlp/yt-dlp#installation",
		);
		process.exit(1);
	}
	console.log(`yt-dlp ${probe.stdout.trim()}`);
}

/** Muxed formats only (`b` selector): yt-dlp merges separate AV streams with
 * ffmpeg, and the whole point is to not require ffmpeg on a fresh machine. */
function buildYtDlpArgs(args: FetchArgs, target: string): string[] {
	const ytArgs = [
		// Node is guaranteed here (the script itself runs on it); modern YouTube
		// extraction needs a JS runtime to solve the n-challenge.
		"--js-runtimes",
		"node",
		// Muxed formats only (`b` selector): yt-dlp merges separate AV streams
		// with ffmpeg, and the whole point is to not require ffmpeg.
		"-f",
		`b[height<=${args.height}]/b`,
		"--no-overwrites",
		"--continue",
		"--no-playlist",
		"--restrict-filenames",
		"-o",
		`${OUTPUT_DIR}/%(id)s.%(ext)s`,
	];
	ytArgs.push(target);
	return ytArgs;
}

function run(
	args: FetchArgs,
	ytArgs: string[],
): Promise<{ code: number; destination: string | null }> {
	const command = ["yt-dlp", ...ytArgs].join(" ");
	if (args.dryRun) {
		console.log(`[dry-run] ${command}`);
		return Promise.resolve({ code: 0, destination: null });
	}
	return new Promise((resolve) => {
		const child = spawn("yt-dlp", ytArgs);
		let destination: string | null = null;
		const onOutput = (chunk: Buffer) => {
			const text = chunk.toString();
			process.stdout.write(text);
			// yt-dlp prints the target path for both fresh downloads and
			// already-downloaded files; capture it so slicing knows the file.
			const match =
				text.match(/Destination: (.+)/) ??
				text.match(/\[download\] (.+) has already been downloaded/);
			if (match) destination = match[1].trim();
		};
		child.stdout.on("data", onOutput);
		child.stderr.on("data", onOutput);
		child.on("exit", (code) => resolve({ code: code ?? 1, destination }));
	});
}

function parseSection(range: string): SectionRange {
	const [from, to] = range.split("-");
	if (!from || !to) {
		console.error(`Invalid --section range: ${range} (expected mm:ss-mm:ss)`);
		process.exit(1);
	}
	const toSecondsParts = to.split(":").map(Number);
	const fromSecondsParts = from.split(":").map(Number);
	const toSeconds =
		toSecondsParts.length === 3
			? toSecondsParts[0] * 3600 + toSecondsParts[1] * 60 + toSecondsParts[2]
			: toSecondsParts[0] * 60 + toSecondsParts[1];
	const fromSeconds =
		fromSecondsParts.length === 3
			? fromSecondsParts[0] * 3600 + fromSecondsParts[1] * 60 + fromSecondsParts[2]
			: fromSecondsParts[0] * 60 + fromSecondsParts[1];
	if (
		Number.isNaN(fromSeconds) ||
		Number.isNaN(toSeconds) ||
		toSeconds <= fromSeconds
	) {
		console.error(`Invalid --section range: ${range}`);
		process.exit(1);
	}
	return { fromSeconds, toSeconds };
}

/**
 * Extracts `fromSeconds`..`toSeconds` from a downloaded file using mediabunny
 * (same engine as the app's clip recorder). Tracks are stream-copied, so the
 * slice is fast and loses no quality.
 */
async function sliceSection(
	inputPath: string,
	outPath: string,
	range: SectionRange,
): Promise<void> {
	const input = new Input({
		source: new FilePathSource(inputPath),
		formats: ALL_FORMATS,
	});
	const output = new Output({
		format: new Mp4OutputFormat({ fastStart: "in-memory" }),
		target: new BufferTarget(),
	});

	const conversion = await Conversion.init({
		input,
		output,
		trim: { start: range.fromSeconds, end: range.toSeconds },
	});

	if (!conversion.isValid) {
		throw new Error(
			`Cannot slice this file: discarded tracks ${conversion.discardedTracks
				.map((track) => `${track.track.type} (${track.reason})`)
				.join(", ")}`,
		);
	}

	await conversion.execute();

	const buffer = output.target.buffer;
	if (!buffer) throw new Error("Slice produced no data");
	await writeFile(outPath, Buffer.from(buffer));
	console.log(`Sliced to ${outPath}`);
}

async function resolveDownloadedFile(videoId: string): Promise<string> {
	// yt-dlp picks the muxed container extension; probe the known ones.
	const extensions = ["mp4", "webm", "mkv"];
	for (const extension of extensions) {
		const candidate = path.join(OUTPUT_DIR, `${videoId}.${extension}`);
		try {
			await access(candidate);
			return candidate;
		} catch {
			// not this extension, try the next
		}
	}
	return path.join(OUTPUT_DIR, `${videoId}.mp4`);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	if (args.list) {
		console.log("Curated lets-plays:\n");
		for (const video of CURATED) {
			console.log(`  ${video.id}  ${video.title}`);
			console.log(`           ${video.channel} · https://youtu.be/${video.id}`);
		}
		console.log(`\nOutput directory: ${OUTPUT_DIR}/ (gitignored)`);
		return;
	}

	requireYtDlp();

	const targets: string[] = [];
	if (args.ids.length > 0) {
		targets.push(...args.ids);
	} else if (args.search) {
		targets.push(`ytsearch${args.max}:${args.search}`);
	} else {
		targets.push(...CURATED.map((video) => video.id));
		console.log(
			`Downloading ${targets.length} curated lets-play(s) into ${OUTPUT_DIR}/ …`,
		);
	}

	if (targets.length === 0) {
		console.error(
			"Nothing to download. Pass --id, --search, or run without flags for the curated list.",
		);
		process.exit(1);
	}

	const range = args.section ? parseSection(args.section) : null;
	let failed = 0;

	for (const target of targets) {
		const label = args.search ? `search "${args.search}"` : target;
		console.log(
			`\n=== Downloading ${label} (<= ${args.height}p, muxed stream) ===`,
		);
		const { code, destination } = await run(
			args,
			buildYtDlpArgs(args, target),
		);
		if (code !== 0) {
			failed += 1;
			continue;
		}

		if (args.dryRun || !range) continue;

		const videoId = VIDEO_ID_RE.test(target)
			? target
			: (target.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)?.[1] ?? target);
		const fullFile = destination ?? (await resolveDownloadedFile(videoId));
		const base = path
			.basename(fullFile)
			.replace(/\.[^.]+$/, "");
		const sliceName = `${base}.${range.fromSeconds}s-${range.toSeconds}s.mp4`;
		try {
			await sliceSection(
				fullFile,
				path.join(OUTPUT_DIR, sliceName),
				range,
			);
			console.log(
				`Full video kept at ${fullFile} (delete it manually if you only need the slice).`,
			);
		} catch (err) {
			console.error(
				`Slice failed: ${err instanceof Error ? err.message : String(err)}`,
			);
			failed += 1;
		}
	}

	if (failed > 0) {
		console.error(`\n${failed} download(s) failed.`);
		process.exit(1);
	}
	console.log(`\nDone. Files in ${OUTPUT_DIR}/`);
}

await main();
