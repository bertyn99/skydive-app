import { createError, defineEventHandler, readBody } from "h3";
import { setVerdict } from "../../utils/evals";

/**
 * Sets the human verdict on one situation result (glossary: Eval run —
 * deterministic checks decide, humans arbitrate).
 * Body: `{ runId, situationId, humanVerdict: "agree" | "override", humanNote? }`.
 */
export default defineEventHandler(async (event) => {
	const body = await readBody<{
		runId?: unknown;
		situationId?: unknown;
		humanVerdict?: unknown;
		humanNote?: unknown;
	}>(event);

	const { runId, situationId, humanVerdict } = body ?? {};
	if (
		typeof runId !== "string" ||
		typeof situationId !== "string" ||
		(humanVerdict !== "agree" && humanVerdict !== "override")
	) {
		throw createError({
			statusCode: 400,
			statusMessage: "runId, situationId and humanVerdict ('agree'|'override') are required",
		});
	}

	try {
		return await setVerdict(
			runId,
			situationId,
			humanVerdict,
			typeof body.humanNote === "string" ? body.humanNote : "",
		);
	} catch (err) {
		throw createError({
			statusCode: 404,
			statusMessage: err instanceof Error ? err.message : String(err),
		});
	}
});
