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
 *   pnpm fetch:letsplays --height 1080         cap resolution (default 1080)
 *   pnpm fetch:letsplays --section 12:00-14:00 also slice this range into a small clip
 *   pnpm fetch:letsplays --dry-run             print the plan, run nothing
 *
 * Quality: YouTube caps muxed (audio+video) streams at 720p. For 1080p the
 * script downloads the best DASH video + audio streams separately and merges
 * them in-process with mediabunny (stream-copied, no re-encode).
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
	Ytdl,
	type VideoFormat,
	type VideoInfo,
} from "@distube/ytdl-core";
import {
	ALL_FORMATS,
	BufferTarget,
	Conversion,
	EncodedAudioPacketSource,
	EncodedPacketSink,
	EncodedVideoPacketSource,
	FilePathSource,
	FilePathTarget,
	Input,
	Mp4OutputFormat,
	Output,
	type AudioCodec,
	type VideoCodec,
} from "mediabunny";

const OUTPUT_DIR = "media/letsplays";

// One YouTube session (PO tokens, blocked clients) shared by search,
// getInfo and downloads.
const ytdl = new Ytdl();

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
		height: 1080,
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

	const info = await ytdl.getInfo(url);
	const { muxed, video, audio } = pickFormats(info, args.height);

	// YouTube caps muxed (audio+video) streams at 720p; higher resolutions
	// come as separate DASH streams, merged in-process with mediabunny.
	if (video && audio && (!muxed || (video.height ?? 0) > (muxed.height ?? 0))) {
		console.log(
			`Quality: DASH ${video.height ?? "?"}p (${video.codecs ?? "video"}) + audio (${audio.codecs ?? "audio"}) — merging with mediabunny`,
		);
		const videoTmp = path.join(OUTPUT_DIR, `${id}.video.tmp`);
		const audioTmp = path.join(OUTPUT_DIR, `${id}.audio.tmp`);
		const mergedPart = `${destination}.part`;
		try {
			await downloadTo(url, video, itagPartFile(id, video), videoTmp);
			await downloadTo(url, audio, itagPartFile(id, audio), audioTmp);
			await mergeVideoAudio(videoTmp, audioTmp, mergedPart);
			await rename(mergedPart, destination);
		} catch (err) {
			// A partial merge at the final path would masquerade as valid
			// material on the next run — keep it in .part and remove on error.
			await rm(mergedPart, { force: true });
			throw err;
		} finally {
			await rm(videoTmp, { force: true });
			await rm(audioTmp, { force: true });
		}
	} else if (muxed) {
		console.log(`Quality: ${muxed.height ?? "?"}p muxed stream`);
		await downloadTo(url, muxed, itagPartFile(id, muxed), destination);
		return destination;
	} else {
		throw new Error(
			"no usable stream at the requested quality — skipped, try another video",
		);
	}

	process.stdout.write("\n");
	console.log(`Downloaded: ${destination}`);
	return destination;
}

/** Per-format part file: the itag scope makes resume data format-specific. */
function itagPartFile(id: string, format: VideoFormat): string {
	return path.join(OUTPUT_DIR, `.${id}.${format.itag}.part`);
}

/**
 * Picks the best formats for a target resolution cap: the best muxed stream,
 * plus the best DASH video/audio pair (mp4 H.264 + m4a AAC) when it is
 * strictly higher quality than anything muxed.
 */
function pickFormats(info: VideoInfo, maxHeight: number): {
	muxed?: VideoFormat;
	video?: VideoFormat;
	audio?: VideoFormat;
} {
	const byHeight = (a: VideoFormat, b: VideoFormat): number =>
		(b.height ?? 0) - (a.height ?? 0) || (b.bitrate ?? 0) - (a.bitrate ?? 0);

	const eligible = info.formats.filter(
		(format) => (format.height ?? 0) <= maxHeight,
	);
	const muxed = eligible
		.filter((format) => format.hasAudio && format.hasVideo)
		.sort(byHeight)[0];
	const video = eligible
		.filter(
			(format) =>
				format.hasVideo &&
				!format.hasAudio &&
				format.container === "mp4" &&
				format.videoCodec?.startsWith("avc1"),
		)
		.sort(byHeight)[0];
	const audio = info.formats
		.filter(
			(format) =>
				format.hasAudio &&
				!format.hasVideo &&
				format.container === "mp4" &&
				(format.audioCodec ?? "").startsWith("mp4a"),
		)
		.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];

	return { muxed, video, audio };
}

async function downloadTo(
	url: string,
	format: VideoFormat,
	partFile: string,
	finalFile: string,
): Promise<void> {
	let lastPercent = -1;

	// Resume: continue from the part file's size when one exists for this
	// exact format (itag-scoped), instead of re-downloading multi-GB data.
	let start = 0;
	try {
		start = (await stat(partFile)).size;
		if (start > 0) {
			console.log(
				`  resuming ${(format.itag ?? "?")} from ${(start / 1024 / 1024).toFixed(1)}MB`,
			);
		}
	} catch {
		// fresh download
	}

	try {
		const stream = ytdl.download(url, {
			// The exact format wins over quality/filter per ChooseFormatOptions.
			format,
			range: start > 0 ? { start } : undefined,
			onProgress: (event) => {
				const downloaded = start + event.downloaded;
				const total = event.total ? start + event.total : undefined;
				if (!total) return;
				const percent = Math.min(
					100,
					Math.floor((downloaded / total) * 100),
				);
				if (percent === lastPercent) return;
				lastPercent = percent;
				process.stdout.write(
					`\r  ${percent}% (${(downloaded / 1024 / 1024).toFixed(1)}MB)`,
				);
			},
		});

		// Append to the part file (resumes keep their prefix), then rename
		// atomically so a failed or empty download never masquerades as
		// usable material.
		await pipeline(stream, createWriteStream(partFile, { flags: "a" }));
		const stats = await stat(partFile);
		if (stats.size === 0) {
			throw new Error("Downloaded file is empty");
		}
		await rename(partFile, finalFile);
	} catch (err) {
		// Keep the part file on failure: it seeds the next resume attempt.
		// (A truncated tail is possible if a crash happened mid-chunk; the
		// next run continues from its size, which is fine for dev material.)
		console.error(
			`\n  download interrupted — part file kept for resume: ${partFile}`,
		);
		throw err;
	}
}

/**
 * Merges a DASH video stream and a DASH audio stream into one mp4 using
 * mediabunny: packets are stream-copied from both inputs into a single
 * output — no re-encode, no ffmpeg. Writes to `outPath.part` and renames
 * atomically, so a failed merge never leaves corrupt material behind.
 */
async function mergeVideoAudio(
	videoPath: string,
	audioPath: string,
	outPath: string,
): Promise<void> {
	const outPart = `${outPath}.part`;
	const videoInput = new Input({
		source: new FilePathSource(videoPath),
		formats: ALL_FORMATS,
	});
	const audioInput = new Input({
		source: new FilePathSource(audioPath),
		formats: ALL_FORMATS,
	});
	const videoTrack = await videoInput.getPrimaryVideoTrack();
	const audioTrack = await audioInput.getPrimaryAudioTrack();
	if (!videoTrack || !audioTrack) {
		await rm(outPart, { force: true });
		throw new Error("DASH merge: missing video or audio track");
	}

	const output = new Output({
		format: new Mp4OutputFormat(),
		target: new FilePathTarget(outPart),
	});
	const videoSource = new EncodedVideoPacketSource(
		videoTrack.codec as VideoCodec,
	);
	const audioSource = new EncodedAudioPacketSource(
		audioTrack.codec as AudioCodec,
	);
	output.addVideoTrack(videoSource);
	output.addAudioTrack(audioSource);

	try {
		await output.start();

		const videoConfig = await videoTrack.getDecoderConfig();
		let firstVideoPacket = true;
		for await (const packet of new EncodedPacketSink(videoTrack).packets()) {
			const meta =
				firstVideoPacket && videoConfig
					? { decoderConfig: videoConfig }
					: undefined;
			await videoSource.add(packet, meta);
			firstVideoPacket = false;
		}

		const audioConfig = await audioTrack.getDecoderConfig();
		let firstAudioPacket = true;
		for await (const packet of new EncodedPacketSink(audioTrack).packets()) {
			const meta =
				firstAudioPacket && audioConfig
					? { decoderConfig: audioConfig }
					: undefined;
			await audioSource.add(packet, meta);
			firstAudioPacket = false;
		}

		await output.finalize();
	} catch (err) {
		if (output.state === "started") {
			await output.cancel();
		}
		await rm(outPart, { force: true });
		throw err;
	}

	await rename(outPart, outPath);
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

	if (!Number.isFinite(args.height) || args.height < 144) {
		console.error(`Invalid --height: ${args.height} (expected >= 144)`);
		process.exit(1);
	}
	if (!Number.isFinite(args.max) || args.max < 1) {
		console.error(`Invalid --max: ${args.max} (expected >= 1)`);
		process.exit(1);
	}

	if (args.list) {
		console.log("Curated lets-plays:\n");
		for (const video of CURATED) {
			console.log(`  ${video.id}  ${video.title}`);
			console.log(`           ${video.channel} · https://youtu.be/${video.id}`);
		}
		console.log(`\nOutput directory: ${OUTPUT_DIR}/ (gitignored)`);
		return;
	}

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
			`\n=== ${label} (${target.id}, <= ${args.height}p) ===`,
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
