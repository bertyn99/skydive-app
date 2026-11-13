#!/usr/bin/env node
/**
 * slice-clip.ts — cut a Situation clip (glossary: Situation) from a big
 * lets-play file with mediabunny (stream-copied packets, no re-encode,
 * no ffmpeg). Companion to `fetch:letsplays` for fixture authoring.
 *
 * Usage:
 *   node scripts/slice-clip.ts <input.(mp4|webm|mkv)> <from> <to> <output>
 *   from/to: "ss" or "mm:ss" or "hh:mm:ss" — e.g.
 *   node scripts/slice-clip.ts media/letsplays/ID.mp4 1:22:00 1:22:10 situations/combat-ambush/clip.mp4
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	ALL_FORMATS,
	BufferTarget,
	Conversion,
	FilePathSource,
	Input,
	Mp4OutputFormat,
	Output,
} from "mediabunny";

function parseTimecode(value: string, label: string): number {
	const parts = value.split(":").map(Number);
	if (parts.some((part) => Number.isNaN(part))) {
		console.error(`Invalid ${label} timecode: ${value}`);
		process.exit(1);
	}
	const seconds =
		parts.length === 3
			? parts[0] * 3600 + parts[1] * 60 + parts[2]
			: parts.length === 2
				? parts[0] * 60 + parts[1]
				: (parts[0] ?? NaN);
	if (!Number.isFinite(seconds) || seconds < 0) {
		console.error(`Invalid ${label} timecode: ${value}`);
		process.exit(1);
	}
	return seconds;
}

async function main(): Promise<void> {
	const [input, fromRaw, toRaw, output] = process.argv.slice(2);
	if (!input || !fromRaw || !toRaw || !output) {
		console.error(
			"Usage: node scripts/slice-clip.ts <input> <from> <to> <output>",
		);
		process.exit(1);
	}

	const from = parseTimecode(fromRaw, "from");
	const to = parseTimecode(toRaw, "to");
	if (to <= from) {
		console.error("to must be after from");
		process.exit(1);
	}

	const dir = path.dirname(output);
	await mkdir(dir, { recursive: true });

	const inputHandle = new Input({
		source: new FilePathSource(input),
		formats: ALL_FORMATS,
	});
	const outputHandle = new Output({
		format: new Mp4OutputFormat({ fastStart: "in-memory" }),
		target: new BufferTarget(),
	});

	const conversion = await Conversion.init({
		input: inputHandle,
		output: outputHandle,
		trim: { start: from, end: to },
	});

	if (!conversion.isValid) {
		throw new Error(
			`Cannot slice this file: discarded tracks ${conversion.discardedTracks
				.map((track) => `${track.track.type} (${track.reason})`)
				.join(", ")}`,
		);
	}

	await conversion.execute();

	const buffer = outputHandle.target.buffer;
	if (!buffer) throw new Error("Slice produced no data");
	await writeFile(output, Buffer.from(buffer));

	const duration = to - from;
	console.log(
		`Sliced ${fromRaw}–${toRaw} (${duration}s) → ${output} (${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB)`,
	);
}

main().catch((err: unknown) => {
	console.error(
		`Failed: ${err instanceof Error ? err.message : String(err)}`,
	);
	process.exit(1);
});
