// Action outbox (Stage 7 / blind-test wiring): queues the actions emitted by
// the session pipelines (composer suggestions, question answers) so the
// SKSE plugin can fetch them by HTTP polling — GET /api/actions?since=<id>.
//
// The plugin is a single consumer; `since` gives at-most-once delivery per
// action. Entries older than MAX_AGE_MS are pruned — actions are immediate
// guidance ("block now"), anything older is worthless. Unknown action types
// are fine here: the plugin's parser whitelists what it can execute and
// ignores the rest.
const MAX_ENTRIES = 50;
const DEFAULT_TTL_MS = 15_000;

/**
 * Per-action TTL overrides: immediate guidance dies fast, but navigation
 * actions must survive long loading screens (the plugin pauses polling
 * during loads, and its `update`-loop timers tick through them — a 15s TTL
 * would drop an autowalk command before the plugin wakes up).
 */
const ACTION_TTL_MS: Record<string, number> = {
	autowalkTo: 60_000,
	autowalkCancel: 60_000,
};

export interface QueuedAction {
	id: number;
	type: string;
	params: Record<string, unknown>;
	/** Which pipeline leg produced it (fused | gated | question). */
	source: string;
	createdAt: number;
	ttlMs: number;
}

let nextId = 1;
const queue: QueuedAction[] = [];

function prune(): void {
	const now = Date.now();
	while (queue.length > 0 && now - queue[0]!.createdAt > queue[0]!.ttlMs) {
		queue.shift();
	}
	while (queue.length > MAX_ENTRIES) {
		queue.shift();
	}
}

export function enqueueActions(
	actions: ReadonlyArray<{ type: string; params: Record<string, unknown> }>,
	source: string,
): number {
	for (const action of actions) {
		queue.push({
			id: nextId++,
			type: action.type,
			params: action.params,
			source,
			createdAt: Date.now(),
			ttlMs: ACTION_TTL_MS[action.type] ?? DEFAULT_TTL_MS,
		});
	}
	prune();
	return nextId - 1;
}

/** Actions newer than `since`, oldest first. */
export function actionsSince(since: number): QueuedAction[] {
	prune();
	return queue.filter((action) => action.id > since);
}

export function lastActionId(): number {
	return nextId - 1;
}

/** Test seam: wipe the queue and reset the counter. */
export function resetActionOutbox(): void {
	queue.length = 0;
	nextId = 1;
}
