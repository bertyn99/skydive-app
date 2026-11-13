import { createError, defineEventHandler, getRouterParam, setResponseHeader } from "h3";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SITUATIONS_DIR } from "../../../utils/evals";

/** Serves a Situation's clip so the dashboard can preview the fixture. */
export default defineEventHandler(async (event) => {
	const id = getRouterParam(event, "id") ?? "";
	if (!/^[\w-]+$/.test(id)) {
		throw createError({ statusCode: 400, statusMessage: "Invalid situation id" });
	}

	const dir = path.join(SITUATIONS_DIR, id);
	let definition: { clip: string };
	try {
		definition = JSON.parse(await readFile(path.join(dir, "situation.json"), "utf8"));
	} catch {
		throw createError({ statusCode: 404, statusMessage: `Unknown situation: ${id}` });
	}
	if (typeof definition.clip !== "string" || definition.clip.includes("..")) {
		throw createError({ statusCode: 400, statusMessage: "Invalid clip reference" });
	}

	const clipPath = path.join(dir, definition.clip);
	const mime = path.extname(clipPath).toLowerCase() === ".webm"
		? "video/webm"
		: "video/mp4";

	try {
		const buffer = await readFile(clipPath);
		setResponseHeader(event, "content-type", mime);
		setResponseHeader(event, "cache-control", "no-store");
		return buffer;
	} catch {
		throw createError({
			statusCode: 404,
			statusMessage: `Clip file missing: ${definition.clip}`,
		});
	}
});
