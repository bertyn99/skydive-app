import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSkyrimState } from "../../../server/utils/skyrim-state-parser";

// The dump contract in executable form — the SAME fixture is asserted by the
// skyguide-skse plugin suite (test/mod-context.test.ts). Keep both copies
// identical (docs/adr/0003-state-channels.md).
// (type alias, not interface — aliases satisfy Record<string, unknown>)
type DumpFixture = {
	float: Record<string, number>;
	int: Record<string, number>;
	string: Record<string, string>;
	floatList: Record<string, number[]>;
	stringList: Record<string, string[]>;
};

const FIXTURE = JSON.parse(
	readFileSync(join(import.meta.dirname, "../../fixtures/dump-v2.json"), "utf-8"),
) as DumpFixture;

describe("parseSkyrimState — world objects (dump v2)", () => {
	it("renders the ### Objets proches section from the shared fixture", () => {
		const text = parseSkyrimState(FIXTURE);
		expect(text).toContain("### Objets proches (4)");
		// nearest-first: Bandit (corpse, 2.2m) before Coffre (locked, 8m)
		const banditIdx = text.indexOf("Bandit");
		const coffreIdx = text.indexOf("Coffre");
		expect(banditIdx).toBeGreaterThan(-1);
		expect(coffreIdx).toBeGreaterThan(banditIdx);
		expect(text).toContain("à 2m");
		expect(text).toContain("direction nord-ouest");
		expect(text).toContain("cadavre");
		expect(text).toContain("verrouillé");
		expect(text).toContain("récolté");
		expect(text).toContain("(npc)");
		expect(text).toContain("(container)");
	});

	it("keeps the legacy sections alongside the new one", () => {
		const text = parseSkyrimState(FIXTURE);
		expect(text).toContain("### Joueur");
		expect(text).toContain("### PNJs proches (2)");
		expect(text).toContain("### Quête active");
	});

	it("drops a stale dump (dump.timestamp older than ~10s) — dead game hygiene", () => {
		const stale = {
			...FIXTURE,
			float: { ...FIXTURE.float, "dump.timestamp": Date.now() - 60_000 },
		};
		expect(parseSkyrimState(stale)).toBe("");
	});

	it("keeps a fresh dump", () => {
		const fresh = {
			...FIXTURE,
			float: { ...FIXTURE.float, "dump.timestamp": Date.now() - 1_000 },
		};
		expect(parseSkyrimState(fresh)).not.toBe("");
	});

	it("never drops pre-v2 dumps without a timestamp", () => {
		expect(parseSkyrimState(FIXTURE)).not.toBe("");
	});

	it("tolerates a dump without world.objects.* (old plugin skew = feature off)", () => {
		const legacy = {
			float: { "player.health": 50 },
			int: {},
			string: {},
			floatList: { "npcs.distance_m": [1] },
			stringList: { "npcs.name": ["Garde"] },
		};
		const text = parseSkyrimState(legacy);
		expect(text).toContain("### PNJs proches");
		expect(text).not.toContain("Objets proches");
	});

	it("hides ### Objets proches when Skyrim Access owns the scanner channel (W2)", () => {
		const coexistence = {
			...FIXTURE,
			int: { ...FIXTURE.int, "skyrim_access.installed": 1 },
		};
		const text = parseSkyrimState(coexistence);
		expect(text).not.toContain("Objets proches");
		// tactical context stays — reflex reads the fast lane, coaching stays
		expect(text).toContain("### PNJs proches");
		expect(text).toContain("### Quête active");
	});

	it("renders the active effects section (W4)", () => {
		const text = parseSkyrimState(FIXTURE);
		expect(text).toContain("### Effets actifs");
		expect(text).toContain("- Guérison mineure");
	});

	it("omits the effects section when empty (absent channel = feature off)", () => {
		const noEffects = {
			...FIXTURE,
			stringList: { ...FIXTURE.stringList, "effects.active": [] },
		};
		expect(parseSkyrimState(noEffects)).not.toContain("Effets actifs");
	});

	it("renders ### Inventaire from additive inventory.* arrays", () => {
		const withInv = {
			...FIXTURE,
			int: { ...FIXTURE.int, "inventory.size": 2 },
			floatList: { ...FIXTURE.floatList, "inventory.count": [1, 4] },
			stringList: { ...FIXTURE.stringList, "inventory.name": ["Iron Sword", "Potion"] },
		};
		const text = parseSkyrimState(withInv);
		expect(text).toContain("### Inventaire (2)");
		expect(text).toContain("- Iron Sword");
		expect(text).toContain("- Potion x4");
	});

	it("omits ### Inventaire when the arrays are absent (old plugin)", () => {
		expect(parseSkyrimState(FIXTURE)).not.toContain("Inventaire");
	});
});
