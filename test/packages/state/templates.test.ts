import { describe, expect, it } from "vitest";
import {
	formatDistance,
	formatNearestObjects,
	formatObjectAnnouncement,
} from "../../../server/utils/templates";

describe("announcement templates (Tier 1 — deterministic, no model)", () => {
	it("follows the ported grammar: name, distance, compass, flags", () => {
		expect(
			formatObjectAnnouncement({
				name: "Coffre",
				distanceM: 8,
				compass: "Nord",
				flags: ["locked"],
			}),
		).toBe("Coffre, à 8 m, nord, verrouillé");
	});

	it("renders multiple flags in the ported order", () => {
		expect(
			formatObjectAnnouncement({
				name: "Coffre",
				distanceM: 3,
				flags: ["locked", "empty"],
			}),
		).toBe("Coffre, à 3 m, verrouillé, vide");
	});

	it("lowercases compass sectors for speech", () => {
		expect(
			formatObjectAnnouncement({ name: "Porte", distanceM: 14, compass: "Nord-Est" }),
		).toBe("Porte, à 14 m, nord-est");
	});

	it("never says 0 meters (their distance-phrasing rule)", () => {
		expect(formatDistance(0.2)).toBe("moins d'un mètre");
		expect(formatDistance(0.4)).toBe("moins d'un mètre");
		expect(formatDistance(0.6)).toBe("1 m");
		expect(formatDistance(8)).toBe("8 m");
	});

	it("rounds to the nearest meter", () => {
		expect(
			formatObjectAnnouncement({ name: "Bandit", distanceM: 2.2 }),
		).toBe("Bandit, à 2 m");
	});

	it("lists up to 3 nearest objects, chained for speech", () => {
		const objects = [
			{ name: "Bandit", distanceM: 2.2 },
			{ name: "Coffre", distanceM: 8, flags: ["locked"] },
			{ name: "Porte", distanceM: 14 },
			{ name: "Souche", distanceM: 18 },
		];
		const spoken = formatNearestObjects(objects);
		expect(spoken).toContain("Bandit, à 2 m");
		expect(spoken).toContain("puis");
		expect(spoken).not.toContain("Souche");
		expect(formatNearestObjects([])).toBe("Aucun objet à proximité.");
	});

	it("drops unknown flags silently (skew-safe)", () => {
		expect(
			formatObjectAnnouncement({ name: "Truc", distanceM: 1, flags: ["future-flag"] }),
		).toBe("Truc, à 1 m");
	});
});
