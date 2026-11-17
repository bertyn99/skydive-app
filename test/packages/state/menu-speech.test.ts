import { describe, expect, it } from "vitest";
import { formatMenuSpeech } from "../../../server/utils/menu-speech";

describe("formatMenuSpeech", () => {
	it("speaks the open line plus the focused item", () => {
		expect(
			formatMenuSpeech({
				name: "InventoryMenu",
				event: "open",
				category: "Weapons",
				item: "Iron Sword",
				index: 2,
				count: 12,
				announceCategory: true,
			}),
		).toBe("Inventaire ouvert. Weapons. Iron Sword, 3 sur 12.");
	});

	it("on focus, does not repeat the open line", () => {
		expect(
			formatMenuSpeech({
				name: "InventoryMenu",
				event: "focus",
				item: "Steel Sword",
				index: 3,
				count: 12,
			}),
		).toBe("Steel Sword, 4 sur 12.");
	});

	it("prefixes a new category when the tab changes", () => {
		expect(
			formatMenuSpeech({
				name: "InventoryMenu",
				event: "focus",
				category: "Apparel",
				item: "Hide Armor",
				index: 0,
				count: 8,
				announceCategory: true,
			}),
		).toBe("Apparel. Hide Armor, 1 sur 8.");
	});

	it("stays silent on close", () => {
		expect(formatMenuSpeech({ name: "InventoryMenu", event: "close" })).toBeNull();
	});

	it("narrates item actions (equip / unequip / use)", () => {
		expect(
			formatMenuSpeech({ name: "", event: "equip", item: "Iron Sword" }),
		).toBe("Équipé : Iron Sword.");
		expect(
			formatMenuSpeech({ name: "", event: "unequip", item: "Hide Armor" }),
		).toBe("Retiré : Hide Armor.");
		expect(
			formatMenuSpeech({ name: "", event: "use", item: "Potion de soin mineure" }),
		).toBe("Utilisé : Potion de soin mineure.");
	});

	it("stays silent for an item action without an item name", () => {
		expect(formatMenuSpeech({ name: "", event: "equip", item: "" })).toBeNull();
	});

	it("stays silent when there is nothing to say", () => {
		expect(formatMenuSpeech(null)).toBeNull();
		expect(formatMenuSpeech({ name: "InventoryMenu", event: "focus" })).toBeNull();
	});
});
