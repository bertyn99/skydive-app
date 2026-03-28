import { spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface CapturedClip {
	video: Buffer;
	thumbnail: Buffer;
	timestamp: number;
	durationMs: number;
	sizeBytes: number;
}

const FFMPEG = "/opt/homebrew/bin/ffmpeg";
const SCREEN_DEVICE = "3:none"; // AVFoundation: Capture screen 0, no audio

/**
 * Record a short screen clip using FFmpeg + AVFoundation.
 * Returns the MP4 buffer + a JPEG thumbnail (last frame).
 */
export function recordClip(durationMs: number): Promise<CapturedClip> {
	const durationSec = durationMs / 1000;
	const ts = Date.now();
	const videoPath = join(tmpdir(), `skydive-clip-${ts}.mp4`);
	const thumbPath = join(tmpdir(), `skydive-thumb-${ts}.jpg`);

	return new Promise((resolve, reject) => {
		const proc = spawn(FFMPEG, [
			"-f", "avfoundation",
			"-framerate", "15",
			"-i", SCREEN_DEVICE,
			"-t", String(durationSec),
			"-vf", "scale=640:-2",
			"-c:v", "libx264",
			"-preset", "ultrafast",
			"-crf", "30",
			"-pix_fmt", "yuv420p",
			"-movflags", "+faststart",
			"-y",
			videoPath,
		], { stdio: ["ignore", "pipe", "pipe"] });

		let stderr = "";
		proc.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		proc.on("error", (err) => reject(new Error(`FFmpeg spawn error: ${err.message}`)));

		proc.on("close", async (code) => {
			if (code !== 0) {
				return reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
			}

			try {
				// Extract thumbnail (last frame) from the recorded video
				await extractThumbnail(videoPath, thumbPath);

				const [video, thumbnail] = await Promise.all([
					readFile(videoPath),
					readFile(thumbPath),
				]);

				// Clean up temp files
				await Promise.all([
					unlink(videoPath).catch(() => {}),
					unlink(thumbPath).catch(() => {}),
				]);

				resolve({
					video,
					thumbnail,
					timestamp: ts,
					durationMs: durationMs,
					sizeBytes: video.length,
				});
			} catch (err) {
				await unlink(videoPath).catch(() => {});
				await unlink(thumbPath).catch(() => {});
				reject(err instanceof Error ? err : new Error(String(err)));
			}
		});
	});
}

function extractThumbnail(videoPath: string, thumbPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = spawn(FFMPEG, [
			"-sseof", "-0.1",
			"-i", videoPath,
			"-frames:v", "1",
			"-q:v", "5",
			"-y",
			thumbPath,
		], { stdio: ["ignore", "ignore", "pipe"] });

		let stderr = "";
		proc.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		proc.on("error", (err) => reject(new Error(`Thumbnail FFmpeg error: ${err.message}`)));
		proc.on("close", (code) => {
			if (code !== 0) {
				return reject(new Error(`Thumbnail extraction failed (code ${code}): ${stderr.slice(-300)}`));
			}
			resolve();
		});
	});
}

/** Kill any lingering FFmpeg processes spawned by us */
export function cleanup() {
	// No persistent process to clean up in per-tick mode
}
