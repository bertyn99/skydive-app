import { readFile } from "node:fs/promises";
import type {
	SkyrimAction,
	SkyrimConnector,
	SkyrimContext,
} from "./skyrim-connector";

// Path to the JSON file dumped by the Skyrim mod
const filePath =
	process.env.SKYRIM_CONTEXT_FILE_PATH ?? "./src/assets/state.json";

export class SkyrimFileConnector implements SkyrimConnector {
	async getContext(): Promise<SkyrimContext> {
		try {
			const content = await readFile(filePath, "utf-8");
			const raw = JSON.parse(content) as Record<string, unknown>;
			return { raw };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[skyrim-file] Failed to read ${filePath}: ${msg}`);
			return { raw: null };
		}
	}

	async sendAction(_action: SkyrimAction): Promise<{ success: boolean }> {
		// File version does not support actions — manual only
		return { success: false };
	}
}
