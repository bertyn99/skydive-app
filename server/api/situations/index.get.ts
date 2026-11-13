import { defineEventHandler } from "h3";
import { listSituations } from "../../utils/evals";

export default defineEventHandler(async () => {
	return listSituations();
});
