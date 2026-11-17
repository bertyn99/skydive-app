import { describe, expect, it } from "vitest";
import {
	decideUtterance,
	resolveChannel,
} from "../../../server/utils/speech-arbiter";

describe("resolveChannel", () => {
	it("reflex tier is always cancel", () => {
		expect(resolveChannel({ tier: "reflex", isQuestion: false })).toBe("cancel");
		expect(resolveChannel({ tier: "reflex", isQuestion: true })).toBe("cancel");
	});

	it("question answers are cancel (the player is waiting)", () => {
		expect(resolveChannel({ tier: "gate", isQuestion: true })).toBe("cancel");
	});

	it("ambient pipeline legs are queue", () => {
		expect(resolveChannel({ tier: "gate", isQuestion: false })).toBe("queue");
	});

	it("menu-focus narration is its own channel", () => {
		expect(resolveChannel({ tier: "menu", isQuestion: false })).toBe("menu");
	});
});

describe("decideUtterance matrix (channel × menu × console × inFlight)", () => {
	it("console open drops EVERYTHING — the screen reader owns that channel", () => {
		expect(
			decideUtterance({ channel: "cancel", menuOpen: false, consoleOpen: true, isPlaying: false }),
		).toBe("drop");
		expect(
			decideUtterance({ channel: "queue", menuOpen: true, consoleOpen: true, isPlaying: false }),
		).toBe("drop");
	});

	it("cancel always interrupts, menus or not", () => {
		expect(
			decideUtterance({ channel: "cancel", menuOpen: false, consoleOpen: false, isPlaying: true }),
		).toBe("stop-and-speak");
		expect(
			decideUtterance({ channel: "cancel", menuOpen: true, consoleOpen: false, isPlaying: false }),
		).toBe("stop-and-speak");
		expect(
			decideUtterance({ channel: "cancel", menuOpen: false, consoleOpen: false, isPlaying: false }),
		).toBe("stop-and-speak");
	});

	it("danger survives menus — a blind player drinks potions from the inventory", () => {
		// reflex "Santé critique" while the inventory is open
		const channel = resolveChannel({ tier: "reflex", isQuestion: false });
		expect(
			decideUtterance({ channel, menuOpen: true, consoleOpen: false, isPlaying: false }),
		).toBe("stop-and-speak");
	});

	it("queue is dropped while a menu is open — never cut menu narration", () => {
		expect(
			decideUtterance({ channel: "queue", menuOpen: true, consoleOpen: false, isPlaying: false }),
		).toBe("drop");
	});

	it("queue is dropped while an utterance is in flight (flood guard — their pendingRead)", () => {
		expect(
			decideUtterance({ channel: "queue", menuOpen: false, consoleOpen: false, isPlaying: true }),
		).toBe("drop");
	});

	it("queue speaks when idle and the game UI is quiet", () => {
		expect(
			decideUtterance({ channel: "queue", menuOpen: false, consoleOpen: false, isPlaying: false }),
		).toBe("speak");
	});

	it("menu channel speaks while a gameplay menu is open", () => {
		expect(
			decideUtterance({ channel: "menu", menuOpen: true, consoleOpen: false, isPlaying: false }),
		).toBe("stop-and-speak");
	});

	it("menu firstRead queues behind the open announcement", () => {
		expect(
			decideUtterance({
				channel: "menu",
				menuOpen: true,
				consoleOpen: false,
				isPlaying: true,
				firstRead: true,
			}),
		).toBe("speak");
	});

	it("menu navigation interrupts the previous item name", () => {
		expect(
			decideUtterance({
				channel: "menu",
				menuOpen: true,
				consoleOpen: false,
				isPlaying: true,
				firstRead: false,
			}),
		).toBe("stop-and-speak");
	});

	it("console still drops menu speech", () => {
		expect(
			decideUtterance({ channel: "menu", menuOpen: true, consoleOpen: true, isPlaying: false }),
		).toBe("drop");
	});
});
