import { defineEventHandler, getQuery } from "h3";
import { actionsSince } from "../utils/action-outbox";

/**
 * Action outbox for the SKSE plugin (HTTP polling — the game is not a WS
 * client). Response is a bare JSON array of { id, type, params, source,
 * createdAt }, oldest first; the plugin tracks the highest id it has seen
 * and sends ?since=<id> so each action is delivered at most once. Unknown
 * types are ignored plugin-side (whitelist parser).
 */
export default defineEventHandler((event) => {
	const query = getQuery(event);
	const raw = query.since;
	const since = typeof raw === "string" ? Number.parseInt(raw, 10) : 0;
	return actionsSince(Number.isFinite(since) && since >= 0 ? since : 0);
});
