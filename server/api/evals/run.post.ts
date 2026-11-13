import { createError, defineEventHandler, readBody } from "h3";
import { getActiveRun, startRun } from "../../utils/evals";

/**
 * Starts an eval run. Body: `{ ids?: string[] }` (all situations when
 * omitted). Returns `{ runId }` immediately — progress is polled via
 * GET /api/evals/runs.
 */
export default defineEventHandler(async (event) => {
	if (getActiveRun()?.status === "running") {
		throw createError({
			statusCode: 409,
			statusMessage: "A run is already in progress",
		});
	}

	const body = await readBody<{ ids?: unknown; judge?: unknown }>(event).catch(() => ({}));
	const ids = Array.isArray(body?.ids)
		? body.ids.filter((id): id is string => typeof id === "string")
		: undefined;
	const judge = body?.judge === undefined ? true : body.judge === true;

	try {
		const run = await startRun(ids, judge);
		return { runId: run.id };
	} catch (err) {
		throw createError({
			statusCode: 400,
			statusMessage: err instanceof Error ? err.message : String(err),
		});
	}
});
