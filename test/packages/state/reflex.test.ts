import { describe, expect, it } from "vitest";
import { evaluateReflex } from "../../../server/utils/reflex";
import type { GameStateData } from "../../../server/utils/protocol";

function state(overrides: Partial<GameStateData> = {}): GameStateData {
	return {
		player: {
			health: 100,
			maxHealth: 100,
			magicka: 100,
			stamina: 100,
			level: 5,
			position: { x: 0, y: 0, z: 0 },
			isSneaking: false,
			isDead: false,
		},
		combatState: 0,
		enemies: [],
		playerAnimation: "",
		eventType: "tick",
		...overrides,
	};
}

describe("evaluateReflex — rule 4: stuck (W3)", () => {
	it("fires the vous-form stuck line", () => {
		const result = evaluateReflex(state({ isStuck: true }));
		expect(result?.rule).toBe("stuck");
		expect(result?.category).toBe("navigation");
		expect(result?.text).toBe("Vous êtes bloqué.");
	});

	it("uses the obstacle bearing for the turn direction (negative = left)", () => {
		expect(evaluateReflex(state({ isStuck: true, stuckRelDeg: -45 }))?.text).toBe(
			"Vous êtes bloqué. Tournez à gauche.",
		);
		expect(evaluateReflex(state({ isStuck: true, stuckRelDeg: 90 }))?.text).toBe(
			"Vous êtes bloqué. Tournez à droite.",
		);
	});

	it("stays silent when not stuck", () => {
		expect(evaluateReflex(state({ isStuck: false }))).toBeNull();
		expect(evaluateReflex(state())).toBeNull(); // old plugin — field absent
	});

	it("death still outranks stuck (rule order)", () => {
		const result = evaluateReflex(state({ isStuck: true, player: { ...state().player, isDead: true } }));
		expect(result?.rule).toBe("death");
	});

	it("announces autowalk arrival on the cancel channel (W6)", () => {
		const result = evaluateReflex(state({ navigation: { status: "arrived" } }));
		expect(result?.rule).toBe("nav-arrival");
		expect(result?.category).toBe("navigation");
		expect(result?.text).toBe("Arrivé.");
	});

	it("stays silent for walking/cancelled/failed/idle navigation statuses", () => {
		for (const status of ["idle", "walking", "cancelled", "failed"] as const) {
			expect(evaluateReflex(state({ navigation: { status } }))).toBeNull();
		}
	});
});
