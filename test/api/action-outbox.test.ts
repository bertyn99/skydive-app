import { beforeEach, describe, expect, it } from "vitest";
import {
	actionsSince,
	enqueueActions,
	lastActionId,
	resetActionOutbox,
} from "../../server/utils/action-outbox";

describe("action outbox", () => {
	beforeEach(() => {
		resetActionOutbox();
	});

	it("hands out monotonic ids and delivers oldest-first after since", () => {
		const last = enqueueActions(
			[
				{ type: "block", params: {} },
				{ type: "notification", params: { message: "Ennemi à gauche" } },
			],
			"gated",
		);
		expect(last).toBe(2);
		expect(lastActionId()).toBe(2);

		enqueueActions([{ type: "heal", params: { amount: 25 } }], "fused");

		const all = actionsSince(0);
		expect(all.map((a) => a.id)).toEqual([1, 2, 3]);
		expect(all[0]?.source).toBe("gated");
		expect(all[2]?.type).toBe("heal");

		// since = at-most-once delivery per action
		const newer = actionsSince(2);
		expect(newer.map((a) => a.id)).toEqual([3]);
	});

	it("applies per-action TTLs — navigation survives loading screens (W4)", () => {
		enqueueActions(
			[
				{ type: "notification", params: { message: "x" } },
				{ type: "autowalkTo", params: { formId: "0x1234", stopDistance: 100 } },
				{ type: "autowalkCancel", params: {} },
			],
			"gated",
		);
		const all = actionsSince(0);
		expect(all.find((a) => a.type === "notification")?.ttlMs).toBe(15_000);
		expect(all.find((a) => a.type === "autowalkTo")?.ttlMs).toBe(60_000);
		expect(all.find((a) => a.type === "autowalkCancel")?.ttlMs).toBe(60_000);
	});

	it("keeps unknown action types — the plugin parser filters them", () => {
		enqueueActions(
			[{ type: "some hallucinated verb", params: { anything: true } }],
			"gated",
		);
		const all = actionsSince(0);
		expect(all).toHaveLength(1);
		expect(all[0]?.type).toBe("some hallucinated verb");
	});

	it("is empty before anything is enqueued", () => {
		expect(actionsSince(0)).toEqual([]);
		expect(lastActionId()).toBe(0);
	});
});
