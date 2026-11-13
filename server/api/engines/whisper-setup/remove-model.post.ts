import { createError, defineEventHandler, readBody } from "h3";
import { removeWhisperModel } from "../../../voice";

/** Deletes a local model copy (file + receipt). Body: `{ modelId: string }`. */
export default defineEventHandler(async (event) => {
	const body = await readBody<{ modelId?: unknown }>(event).catch(() => ({}));
	if (typeof body?.modelId !== "string") {
		throw createError({ statusCode: 400, statusMessage: "body must be { modelId: string }" });
	}

	try {
		await removeWhisperModel(body.modelId);
		return { ok: true };
	} catch (err) {
		throw createError({
			statusCode: 400,
			statusMessage: err instanceof Error ? err.message : String(err),
		});
	}
});
