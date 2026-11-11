import { defineEventHandler } from "h3";
import { getConfig } from "../utils/engine";

export default defineEventHandler(() => {
	return getConfig();
});
