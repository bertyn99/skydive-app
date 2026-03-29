import type {
	SkyrimAction,
	SkyrimConnector,
	SkyrimContext,
} from "./skyrim-connector";

// Path to the JSON file dumped by the Skyrim mod
const _filePath =
	process.env.SKYRIM_CONTEXT_FILE_PATH ?? "./skyrim-context.json";

export class SkyrimFileConnector implements SkyrimConnector {
	async getContext(): Promise<SkyrimContext> {
		// TODO: read and parse JSON from _filePath
		return { raw: null };
	}

	async sendAction(_action: SkyrimAction): Promise<{ success: boolean }> {
		// File version does not support actions — manual only
		return { success: false };
	}
}
