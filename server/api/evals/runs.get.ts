import { defineEventHandler } from "h3";
import { listRuns } from "../../utils/evals";

/** All persisted eval runs (newest first) + the in-memory active run. */
export default defineEventHandler(async () => {
	return listRuns();
});
