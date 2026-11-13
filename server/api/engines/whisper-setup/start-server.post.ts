import { createError, defineEventHandler, readBody } from "h3";
import { startWhisperServer } from "../../../utils/whisper-server";

/**
 * Starts the whisper.cpp sidecar against a verified model (defaults to the
 * recommended one, then the first usable). Body: `{ modelId?: string }`.
 * Waits for the server to answer before returning its status.
 */
export default defineEventHandler(async (event) => {
	const body = await readBody<{ modelId?: unknown }>(event).catch(() => ({}));
	const modelId = typeof body?.modelId === "string" ? body.modelId : undefined;

	try {
		return await startWhisperServer(modelId);
	} catch (err) {
		throw createError({
			statusCode: 503,
			statusMessage: err instanceof Error ? err.message : String(err),
		});
	}
});
