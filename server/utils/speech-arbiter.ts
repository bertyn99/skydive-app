/**
 * Speech arbiter (W2) — ported from Skyrim Access's speech model
 * (docs/ACCESSIBILITY-PORT.md §5.4): a cancel channel for tactical speech
 * and a queue channel for flavour, ONE utterance in flight, and silence
 * while the game's own UI is talking (menus, console, screen readers).
 *
 * This module is the PURE decision matrix. `engine.ts` owns the in-flight
 * bookkeeping and the actual `audio_stop` broadcast; cooldowns stay where
 * they are today (engine.ts reflexLastFired) — the arbiter adds NO second
 * cooldown (plan D6 / review fix).
 */

export type SpeechChannel = "cancel" | "queue" | "menu";

export type ArbiterDecision = "speak" | "stop-and-speak" | "drop";

export interface ChannelInputs {
	/** provenance.tier from the pipeline leg ("gate" | "reflex" | "menu"). */
	tier: string;
	isQuestion: boolean;
	/** relevance is informational here — relevance gating already happened. */
	relevance?: number;
}

/**
 * Cancel = tactical (reflex callouts, danger, nav arrival in W6) and direct
 * question answers (the player is waiting). Everything ambient = queue.
 */
export function resolveChannel(inputs: ChannelInputs): SpeechChannel {
	if (inputs.tier === "reflex") return "cancel";
	if (inputs.isQuestion) return "cancel";
	if (inputs.tier === "menu") return "menu";
	return "queue";
}

export interface UtteranceInputs {
	channel: SpeechChannel;
	/** Gameplay-blocking menu open (fast-lane `ui.menuOpen`, ≤1 tick old). */
	menuOpen: boolean;
	/** Console open — the screen reader owns that channel, full stop. */
	consoleOpen: boolean;
	/** An utterance is currently playing on the client (unacked). */
	isPlaying: boolean;
	/**
	 * First item after a menu-open announcement. Queue so we do not cut
	 * "Inventaire ouvert." (Skyrim Access firstRead).
	 */
	firstRead?: boolean;
}

/**
 * The matrix:
 *  - console open          → drop EVERYTHING (their suspension rule)
 *  - menu open + queue     → drop (their "queue items must not cut menu narration")
 *  - menu open + cancel    → stop-and-speak (vitals/danger survive menus —
 *                            a blind player drinks potions from the inventory)
 *  - idle + queue          → speak
 *  - playing + queue       → drop (flood guard: one utterance in flight; the
 *                            client's latest-wins queue stays as belt-and-braces)
 *  - menu + firstRead + playing → speak (queue; do not cut "menu open")
 *  - menu                       → stop-and-speak (list navigation)
 *  - cancel (always)            → stop-and-speak (interrupts current speech)
 */
export function decideUtterance(inputs: UtteranceInputs): ArbiterDecision {
	if (inputs.consoleOpen) return "drop";
	if (inputs.channel === "cancel") return "stop-and-speak";
	if (inputs.channel === "menu") {
		if (inputs.firstRead && inputs.isPlaying) return "speak";
		return "stop-and-speak";
	}
	if (inputs.menuOpen) return "drop";
	if (inputs.isPlaying) return "drop";
	return "speak";
}
