import { defineEventHandler } from "h3";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export interface MediaFile {
	/** File name only — fetch bytes via /api/media/file/<name>. */
	name: string;
	size: number;
}

const MEDIA_DIR = path.join(process.cwd(), "media", "letsplays");

/**
 * Sim-source library: the lets-play clips downloaded by
 * `pnpm fetch:letsplays` (media/ is gitignored). The dashboard lists them
 * for the video-file source so eval material doesn't need a local copy.
 */
export default defineEventHandler(async (): Promise<{ files: MediaFile[] }> => {
	let entries: string[];
	try {
		entries = await readdir(MEDIA_DIR);
	} catch {
		// media/ doesn't exist yet — nothing fetched on this machine.
		return { files: [] };
	}

	const files = await Promise.all(
		entries
			.filter((name) => name.endsWith(".mp4"))
			.map(async (name) => {
				const stats = await stat(path.join(MEDIA_DIR, name));
				return { name, size: stats.size };
			}),
	);

	return { files: files.sort((a, b) => a.name.localeCompare(b.name)) };
});
