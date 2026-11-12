#!/usr/bin/env node
/**
 * fetch-letsplays.ts — download Skyrim lets-play source videos for the Sim
 * session (glossary: Simulation session). Videos land in `media/letsplays/`,
 * which is gitignored: multi-hour files never enter git. On a fresh machine,
 * run `pnpm fetch:letsplays` to rebuild the local dev corpus.
 *
 * Pure npm: @distube/ytdl-core downloads, mediabunny slices (time ranges).
 * No yt-dlp, no python, no ffmpeg.
 *
 * Usage:
 *   pnpm fetch:letsplays                       download every curated video
 *   pnpm fetch:letsplays --list                show the curated list
 *   pnpm fetch:letsplays --id <id|url>         download one specific video
 *   pnpm fetch:letsplays --search "<query>"    search YouTube, download top results
 *   pnpm fetch:letsplays --max 3               cap search results (default 3)
 *   pnpm fetch:letsplays --height 720          cap resolution (default 720, muxed streams only)
 *   pnpm fetch:letsplays --section 12:00-14:00 also slice this range into a small clip
 *   pnpm fetch:letsplays --dry-run             print the plan, run nothing
 *
 * For personal development and testing use only.
 */

import { createWriteStream } from "node:fs";
import {
	mkdir,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pipeline } from "node:stream/promises";
import {
	parseVideoId,
	Quality,
	Ytdl,
	YtdlError,
} from "@distube/ytdl-core";
import type { FormatMetadata } from "@distube/ytdl-core";
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
				if (parseVideoId(arg) ?? /^[A-Za-z0-9_-]{11}$/.test(arg)) {
					args.ids.push(arg);
				} else {
					console.error(`Unknown argument: ${arg}`);
					process.exit(1);
				}
		}
	}
	return args;
}

async function downloadVideo(id: string, args: FetchArgs): Promise<string> {
	const url = `https://www.youtube.com/watch?v=${id}`;
	const destination = path.join(OUTPUT_DIR, `${id}.mp4`);
	try {
		const stats = await stat(destination);
		if (stats.size > 0) {
			console.log(`Already downloaded: ${destination}`);
			return destination;
		}
		console.log(`Found empty file, re-downloading: ${destination}`);
	} catch {
		// not downloaded yet — proceed
	}

	const ytdl = new Ytdl();
	let lastPercent = -1;
	const partFile = `${destination}.part`;
	try {
		const stream = ytdl.download(url, {
			// Tried in order: height-capped muxed first, then any muxed stream —
			// some videos only serve one muxed format, at a lower resolution.
			filter: [
				(format: FormatMetadata) =>
					format.hasAudio &&
					format.hasVideo &&
					(format.height ?? 0) <= args.height,
				{ hasAudio: true, hasVideo: true },
			],
			quality: Quality.Highest,
			onProgress: (event) => {
				if (!event.total) return;
				const percent = Math.floor((event.downloaded / event.total) * 100);
				if (percent === lastPercent) return;
				lastPercent = percent;
				process.stdout.write(
					`\r  ${percent}% (${(event.downloaded / 1024 / 1024).toFixed(1)}MB)`,
				);
			},
		});

		// Write to a .part file and rename atomically, so a failed or empty
		// download never masquerades as usable material.
		await pipeline(stream, createWriteStream(partFile));
		const stats = await stat(partFile);
		if (stats.size === 0) {
			throw new Error("Downloaded file is empty");
		}
		await rename(partFile, destination);
	} catch (err) {
		await rm(partFile, { force: true });
		if (err instanceof YtdlError && err.code === "NO_FORMAT") {
			throw new Error(
				"no muxed (audio+video) stream available — skipped, try another video",
				{ cause: err },
			);
		}
		throw err;
	}

	process.stdout.write("\n");
	console.log(`Downloaded: ${destination}`);
	return destination;
}

function parseSection(range: string): SectionRange {
	const [from, to] = range.split("-");
	if (!from || !to) {
		console.error(`Invalid --section range: ${range} (expected mm:ss-mm:ss)`);
		process.exit(1);
	}
	const toParts = to.split(":").map(Number);
	const fromParts = from.split(":").map(Number);
	const toSeconds =
		toParts.length === 3
			? toParts[0] * 3600 + toParts[1] * 60 + toParts[2]
			: toParts[0] * 60 + toParts[1];
	const fromSeconds =
		fromParts.length === 3
			? fromParts[0] * 3600 + fromParts[1] * 60 + fromParts[2]
			: fromParts[0] * 60 + fromParts[1];
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

	const ytdl = new Ytdl();

	interface Target {
		id: string;
		title?: string;
	}

	let targets: Target[];
	if (args.ids.length > 0) {
		targets = args.ids.map((id) => ({
			id: parseVideoId(id) ?? id,
		}));
	} else if (args.search) {
		if (args.dryRun) {
			console.log(`[dry-run] would search "${args.search}" (top ${args.max})`);
			return;
		}
		console.log(`Searching YouTube: "${args.search}" …`);
		const results = await ytdl.search(args.search);
		targets = results.slice(0, args.max).map((video) => ({
			id: video.id,
			title: video.title,
		}));
		if (targets.length === 0) {
			console.error("Search returned no videos.");
			process.exit(1);
		}
	} else {
		targets = CURATED.map((video) => ({ id: video.id, title: video.title }));
		console.log(
			`Downloading ${targets.length} curated lets-play(s) into ${OUTPUT_DIR}/ …`,
		);
	}

	const range = args.section ? parseSection(args.section) : null;
	await mkdir(OUTPUT_DIR, { recursive: true });
	let failed = 0;

	for (const target of targets) {
		const label = target.title ?? target.id;
		console.log(
			`\n=== ${label} (${target.id}, <= ${args.height}p, muxed stream) ===`,
		);
		if (args.dryRun) {
			console.log(
				`[dry-run] download -> ${path.join(OUTPUT_DIR, `${target.id}.mp4`)}${
					range
						? ` + slice ${range.fromSeconds}s-${range.toSeconds}s`
						: ""
				}`,
			);
			continue;
		}

		try {
			const fullFile = await downloadVideo(target.id, args);
			if (range) {
				const base = path.basename(fullFile).replace(/\.[^.]+$/, "");
				await sliceSection(
					fullFile,
					path.join(
						OUTPUT_DIR,
						`${base}.${range.fromSeconds}s-${range.toSeconds}s.mp4`,
					),
					range,
				);
				console.log(
					`Full video kept at ${fullFile} (delete it manually if you only need the slice).`,
				);
			}
		} catch (err) {
			failed += 1;
			console.error(
				`Failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	if (failed > 0) {
		console.error(`\n${failed} download(s) failed.`);
		process.exit(1);
	}
	console.log(`\nDone. Files in ${OUTPUT_DIR}/`);
}

await main();
