import { describe, expect, it } from "vitest";
import {
	selectRadarCues,
	RADAR_MAX_CUES,
	RADAR_RADIUS_UNITS,
} from "../../../server/packages/spatial";

interface FixtureObjects {
	names: string[];
	categories: string[];
	ids: number[];
	distancesU: number[];
	bearingsDeg: number[];
}

function dump(objects: FixtureObjects, ints: Record<string, number> = {}): Record<string, unknown> {
	return {
		float: {},
		int: { "dump.version": 2, ...ints },
		string: {},
		floatList: {
			"npcs.distance_m": [],
			"world.objects.distance_m": objects.distancesU.map((u) => u / 70),
			"world.objects.distance_u": objects.distancesU,
			"world.objects.form_id": objects.ids,
			"world.objects.bearing_deg": objects.bearingsDeg,
			"world.objects.lock_level": [],
			"world.objects.dz": [],
		},
		stringList: {
			"npcs.name": [],
			"npcs.clock": [],
			"world.objects.name": objects.names,
			"world.objects.category": objects.categories,
			"world.objects.flags": objects.names.map(() => ""),
			"world.objects.compass": objects.names.map(() => ""),
			"effects.active": [],
		},
	};
}

const BASE_OBJECTS: FixtureObjects = {
	names: ["Coffre", "Porte", "Bandit"],
	categories: ["container", "door", "npc"],
	ids: [16777217, 16777218, 16777219],
	distancesU: [560, 980, 154],
	bearingsDeg: [10, 90, 315],
};

describe("selectRadarCues (W5 — their radar constants)", () => {
	it("selects in-radius cues nearest-first with relative bearings", () => {
		// Player facing 90° (east): the door at absolute 90° is straight ahead.
		const cues = selectRadarCues({ raw: dump(BASE_OBJECTS), playerHeadingDeg: 90 });
		expect(cues).toHaveLength(3);
		expect(cues[0]!.id).toBe(16777219); // Bandit, 154u — nearest first
		expect(cues[0]!.bearingRad).toBeCloseTo(((315 - 90 + 540) % 360 - 180) * Math.PI / 180, 2);
		const door = cues.find((cue) => cue.id === 16777218)!;
		expect(door.bearingRad).toBeCloseTo(0, 3); // dead ahead
	});

	it("cues carry the ported radius and a floored gain falloff", () => {
		const cues = selectRadarCues({ raw: dump(BASE_OBJECTS), playerHeadingDeg: 0 });
		for (const cue of cues) {
			expect(cue.distanceU).toBeLessThanOrEqual(RADAR_RADIUS_UNITS);
			expect(cue.gain).toBeGreaterThanOrEqual(0.08);
			expect(cue.gain).toBeLessThanOrEqual(1);
		}
		// 154u of 1500 → gain ≈ 0.9 ; 980u → ≈ 0.35
		const bandit = cues.find((cue) => cue.id === 16777219)!;
		const door = cues.find((cue) => cue.id === 16777218)!;
		expect(bandit.gain).toBeGreaterThan(door.gain);
		expect(door.gain).toBeCloseTo(1 - 980 / 1500, 2);
	});

	it("cuts everything beyond the 1500-unit radius", () => {
		const objects: FixtureObjects = {
			...BASE_OBJECTS,
			distancesU: [100, 1499, 1500, 1501],
			ids: [1, 2, 3, 4],
		};
		const cues = selectRadarCues({ raw: dump(objects), playerHeadingDeg: 0 });
		expect(cues.map((cue) => cue.id)).toEqual([1, 2, 3]); // 1501 excluded
	});

	it("caps the sweep at 8 cues (their per-cycle limit)", () => {
		const count = 12;
		const objects: FixtureObjects = {
			names: Array.from({ length: count }, (_, i) => `Objet ${i}`),
			categories: Array.from({ length: count }, () => "container"),
			ids: Array.from({ length: count }, (_, i) => i + 1),
			distancesU: Array.from({ length: count }, (_, i) => 100 + i * 90),
			bearingsDeg: Array.from({ length: count }, (_, i) => i * 30),
		};
		const cues = selectRadarCues({ raw: dump(objects), playerHeadingDeg: 0 });
		expect(cues).toHaveLength(RADAR_MAX_CUES);
	});

	it("returns an empty sweep when Skyrim Access owns the radar channel (W2)", () => {
		const cues = selectRadarCues({
			raw: dump(BASE_OBJECTS, { "skyrim_access.installed": 1 }),
			playerHeadingDeg: 0,
		});
		expect(cues).toEqual([]);
	});

	it("tolerates a malformed dump (short arrays, missing channels)", () => {
		expect(selectRadarCues({ raw: {}, playerHeadingDeg: 0 })).toEqual([]);
		const skewed = dump(BASE_OBJECTS);
		// Drop one entry from the ids array — lock-step violation must not throw.
		(skewed.floatList as Record<string, unknown>)["world.objects.form_id"] = [16777217, 16777218];
		expect(selectRadarCues({ raw: skewed, playerHeadingDeg: 0 })).toHaveLength(2);
	});

	it("null heading keeps absolute bearings (degraded but usable)", () => {
		const cues = selectRadarCues({ raw: dump(BASE_OBJECTS), playerHeadingDeg: null });
		const door = cues.find((cue) => cue.id === 16777218)!;
		expect(door.bearingRad).toBeCloseTo((Math.PI / 2), 3); // absolute 90°
	});
});
