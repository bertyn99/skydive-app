import { createError, defineEventHandler, getRouterParam } from "h3";
import { getRun } from "../../../utils/evals";

export default defineEventHandler(async (event) => {
	const id = getRouterParam(event, "id") ?? "";
	const run = await getRun(id);
	if (!run) {
		throw createError({ statusCode: 404, statusMessage: `Unknown run: ${id}` });
	}
	return run;
});
