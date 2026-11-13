import { createError, defineEventHandler, readBody } from "h3";
import { installWhisperModel, whisperInstallState } from "../../../voice";

/**
 * Starts downloading a pinned whisper model. Body: `{ modelId: string }`.
 * Returns `{ install }` immediately — progress is polled via
 * GET /api/engines/whisper-setup. 409 when a download is already running.
 */
export default defineEventHandler(async (event) => {
	const body = await readBody<{ modelId?: unknown }>(event).catch(() => ({}));
	if (typeof body?.modelId !== "string") {
		throw createError({ statusCode: 400, statusMessage: "body must be { modelId: string }" });
	}

	if (whisperInstallState()?.status === "downloading") {
		throw createError({
			statusCode: 409,
			statusMessage: "A model download is already in progress",
		});
	}

	try {
		const install = await installWhisperModel(body.modelId);
		return { install };
	} catch (err) {
		throw createError({
			statusCode: 400,
			statusMessage: err instanceof Error ? err.message : String(err),
		});
	}
});
