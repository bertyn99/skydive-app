import type { GameStateData } from "./protocol";
import type { GateCategory } from "./gate";

/**
 * Reflex rules (LIFT-PLAN Stage 5): canned callouts derived purely from the
 * mod context in ~0ms, bypassing the Gate and the composer. They exist for
 * true emergencies where a model round-trip costs too much (health critical,
 * death, melee contact). Everything else goes through the Gate.
 */

export interface ReflexCallout {
	/** Rule id, used for cooldown bookkeeping. */
	rule: string;
	category: GateCategory;
	text: string;
}

/** Minimum delay between two reflex callouts of the same rule (anti-spam). */
export const REFLEX_COOLDOWN_MS = 8000;

const CONTACT_DISTANCE = 250;
const CRITICAL_HEALTH_RATIO = 0.25;

export function evaluateReflex(state: GameStateData): ReflexCallout | null {
	// 1. Death — nothing else matters.
	if (state.player.isDead) {
		return { rule: "death", category: "danger", text: "Vous êtes à terre." };
	}

	// 2. Critical health — act now.
	const healthRatio = state.player.maxHealth > 0
		? state.player.health / state.player.maxHealth
		: 1;
	if (healthRatio <= CRITICAL_HEALTH_RATIO) {
		return {
			rule: "health-critical",
			category: "danger",
			text: "Santé critique. Buvez une potion.",
		};
	}

	// 3. Melee contact during combat — block.
	if (state.combatState > 0) {
		const nearest = state.enemies
			.map((enemy) => enemy.distance)
			.sort((a, b) => a - b)[0];
		if (nearest !== undefined && nearest <= CONTACT_DISTANCE) {
			return {
				rule: "melee-contact",
				category: "danger",
				text: "Ennemi au contact. Bloquez !",
			};
		}
	}

	return null;
}
