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
const MAX_AGE_MS = 15_000;

export interface QueuedAction {
	id: number;
	type: string;
	params: Record<string, unknown>;
	/** Which pipeline leg produced it (fused | gated | question). */
	source: string;
	createdAt: number;
}

let nextId = 1;
const queue: QueuedAction[] = [];

function prune(): void {
	const cutoff = Date.now() - MAX_AGE_MS;
	while (queue.length > 0 && queue[0].createdAt < cutoff) {
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
