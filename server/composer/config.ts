// Shared composer-stack internals: env knobs, the probe shape (re-exported
// from the voice module's public API so every seam reports availability
// identically), and the compose contract shared by every provider.
// One-directional imports: providers → config → (voice public API only).

import { z } from "zod/v4";
import type { SystemModelMessage } from "ai";
import type { EngineProbe } from "../voice";

// --- Self-hosted composer (YGG-248-style adapter, Stage 6) ------------------
// Any vision-capable model behind an OpenAI-compatible endpoint works:
// Ollama (qwen2.5vl), LM Studio, vLLM. Failure to reach it surfaces as an
// unavailable engine / chain fallback, never as a crash.
export const COMPOSER_LOCAL_BASE_URL =
	process.env.COMPOSER_LOCAL_BASE_URL ?? "http://127.0.0.1:11434/v1";
export const COMPOSER_LOCAL_MODEL =
	process.env.COMPOSER_LOCAL_MODEL ?? "qwen2.5vl:7b";
export const COMPOSER_LOCAL_API_KEY = process.env.COMPOSER_LOCAL_API_KEY;
export const COMPOSER_TIMEOUT_MS = Number(process.env.COMPOSER_TIMEOUT_MS ?? 60_000);

export type { EngineProbe };

// --- Compose contract -------------------------------------------------------

export interface ComposeInput {
	clip: { buffer: Buffer; mediaType: string };
	/** Observation history already told to the player (novelty context). */
	history: string[];
	/** Mod context text (parseSkyrimState output) or null. */
	modContext?: string | null;
	/** Explicit player question — overrides the action-only style. */
	question?: string;
	/** Operator system prompt override. */
	systemPrompt?: string;
	/** What the gate decided and why (≤8-word summary). */
	intention?: { summary: string };
}

export interface ComposeOutput {
	observation: string | null;
	relevance: number;
	actions: Array<{ type: string; params: Record<string, unknown> }>;
	/** Model id that composed (provenance). */
	modelId: string;
}

export const composeSchema = z.object({
	observation: z
		.string()
		.nullable()
		.describe(
			"Ce que le joueur doit entendre MAINTENANT, en français. Null seulement si le clip est vraiment illisible.",
		),
	relevance: z
		.int()
		.min(0)
		.max(10)
		.describe("Pertinence de l'observation (0-10)."),
	actions: z
		.array(
			z.object({
				type: z.string().describe("Identifiant court de l'action (ex: 'block', 'open_door')"),
				params: z.record(z.string(), z.unknown()).describe("Paramètres de l'action"),
			}),
		)
		.default([])
		.describe("Actions suggérées, si pertinent."),
});

const COMPOSER_RULES_PROMPT = `
Tu es le compositeur de SkyGuide (assistant temps réel pour joueur aveugle de Skyrim).
Le filtre de décision a DÉJÀ déterminé que le joueur doit entendre quelque chose MAINTENANT.
Ton rôle n'est PAS de décider : c'est de formuler l'observation en français.

RÈGLES D'OBSERVATION :
* max 2 phrases, max 8 mots par phrase
* uniquement de l'information actionnable : [élément] + [direction] + [distance/action]
* pas de description décorative, pas de lore, pas de spéculation
* ne répète pas l'historique fourni (déjà dit au joueur)
* réponds toujours en français

Si le clip est vraiment illisible : observation = brève excuse en français
("Je ne vois pas clairement, restez immobile une seconde."), relevance basse.
`;

export function composerSystemMessages(input: ComposeInput): SystemModelMessage[] {
	const system: SystemModelMessage[] = [];
	// Operator override first, composer rules always apply underneath.
	if (input.systemPrompt) {
		system.push({ role: "system", content: input.systemPrompt });
	}
	system.push({ role: "system", content: COMPOSER_RULES_PROMPT });
	if (input.modContext) {
		system.push({
			role: "system",
			content: `## ÉTAT DU MOD SKYRIM (temps réel)\n${input.modContext}`,
		});
	}
	if (input.history.length > 0) {
		system.push({
			role: "system",
			content: `Déjà dit au joueur (NE PAS répéter) :\n${input.history.map((line) => `- ${line}`).join("\n")}`,
		});
	}
	if (input.intention?.summary) {
		system.push({
			role: "system",
			content: `## CONSIGNE DU FILTRE (System 1)\nDécision déjà prise : le joueur doit entendre quelque chose MAINTENANT.\nIntention à formuler : « ${input.intention.summary} ».`,
		});
	}
	if (input.question) {
		system.push({
			role: "system",
			content:
				"## MODE QUESTION\nLe joueur pose une question explicite : réponds directement, de façon concise et actionnable.",
		});
	}
	return system;
}

function extractJson(text: string): unknown {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start === -1 || end <= start) {
		throw new Error("local composer returned no JSON object");
	}
	return JSON.parse(text.slice(start, end + 1));
}

export function parseComposerJson(text: string): z.infer<typeof composeSchema> {
	return composeSchema.parse(extractJson(text));
}
