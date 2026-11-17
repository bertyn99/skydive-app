import { readFile } from "node:fs/promises";
import type { SkyrimContext, SkyrimConnector } from "./skyrim-connector";

const filePath = process.env.SKYRIM_CONTEXT_FILE_PATH;

/**
 * Context-lane connector with a transport fallback:
 * 1. the state.json file (context lane as designed in ADR 0003) — the Skyrim
 *    Platform runtime's `fs` shim is EMPTY, so the plugin usually cannot
 *    write it;
 * 2. the additive `context` field riding the plugin's protocol-v1 POST
 *    (same payload, same consumer) — stashed by the engine from the latest
 *    game-state POST.
 */
export class SkyrimHybridConnector implements SkyrimConnector {
	private readonly getPostedContext: () => Record<string, unknown> | null;
	private lastWarnAt = 0;

	constructor(getPostedContext: () => Record<string, unknown> | null) {
		this.getPostedContext = getPostedContext;
	}

	async getContext(): Promise<SkyrimContext> {
		if (filePath) {
			try {
				const content = await readFile(filePath, "utf-8");
				const raw = JSON.parse(content) as Record<string, unknown>;
				return { raw };
			} catch {
				// ENOENT is the expected steady state — warn at most every 60s.
				const now = Date.now();
				if (now - this.lastWarnAt > 60_000) {
					this.lastWarnAt = now;
					console.warn(
						`[skyrim-file] ${filePath} not written by the plugin (SP fs is empty) — using protocol POST context`,
					);
				}
			}
		}
		return { raw: this.getPostedContext() };
	}

	// The hybrid reads; actions still flow through the HTTP polling lane.
	async sendAction(): Promise<{ success: boolean }> {
		return { success: false };
	}
}
