import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
	Output,
	generateText,
	type SystemModelMessage,
	type UserModelMessage,
} from "ai";
import { z } from "zod/v4";
import { GEMINI_MODEL, GEMINI_MODEL_ID } from "./gemini";
import type { GameStateData } from "./protocol";
import { evaluateReflex } from "./reflex";

/**
 * Decision-model Gate (LIFT-PLAN Stage 5, System 1). Decides WHETHER the
 * player should hear something before any composer runs: shouldSpeak,isNew,
 * relevance class, category and a calibrated confidence. State = mod context
 * JSON + observation history + clip.
 *
 * Engines:
 *   - gemini:  decision-only Gemini call (fast, same model, no composer).
 *   - local:   any self-hosted decision model behind an OpenAI-compatible
 *              endpoint (Ollama / LM Studio / vLLM — YGG-248 adapter).
 *              Unconfigured/unreachable = unavailable, callers degrade.
 *   - rules:   clip-blind heuristic on the mod context only. Serves as the
 *              baseline in the eval matrix (and proves why vision is needed).
 */

export type GateRelevance = "silence" | "minor" | "useful" | "critical";
export type GateCategory =
	| "danger"
	| "interaction"
	| "navigation"
	| "change"
	| "question";

export type GateEngineId = "gemini" | "local" | "rules";

export function isGateEngineId(value: unknown): value is GateEngineId {
	return (
		typeof value === "string" &&
		(GATE_ENGINE_IDS as readonly string[]).includes(value)
	);
}

/** Narrow an untrusted value (env var, WS command) to a gate engine id. */
export function resolveGateEngine(
	value: unknown,
	fallback: GateEngineId,
): GateEngineId {
	return isGateEngineId(value) ? value : fallback;
}

export const GATE_ENGINE_IDS: readonly GateEngineId[] = [
	"gemini",
	"local",
	"rules",
] as const;

export interface GateDecision {
	/** Speak to the player now? */
	shouldSpeak: boolean;
	/** Is this information new vs the observation history? */
	isNew: boolean;
	relevance: GateRelevance;
	category: GateCategory;
	/** Self-reported calibration 0..1 (1 = certain). */
	confidence: number;
	/** ≤8-word summary of what the player should hear (composer handoff). */
	summary: string;
}

export interface GateProvenance {
	engine: GateEngineId;
	modelId: string;
	latencyMs: number;
}

export interface GateResult {
	decision: GateDecision;
	provenance: GateProvenance;
}

/** Numeric calibration targets for the relevance classes (band mapping). */
export const RELEVANCE_VALUE: Record<GateRelevance, number> = {
	silence: 0,
	minor: 2,
	useful: 5,
	critical: 8,
};

const decisionSchema = z.object({
	shouldSpeak: z
		.boolean()
		.describe("Le joueur doit-il entendre quelque chose MAINTENANT ?"),
	isNew: z
		.boolean()
		.describe("L'information est-elle nouvelle vs l'historique fourni ?"),
	relevance: z
		.enum(["silence", "minor", "useful", "critical"])
		.describe("silence = rien à dire. minor = pas la peine. useful = utile. critical = urgent."),
	category: z.enum(["danger", "interaction", "navigation", "change", "question"]),
	confidence: z
		.number()
		.min(0)
		.max(1)
		.describe("Ta certitude sur cette décision, entre 0 et 1."),
	summary: z
		.string()
		.describe("En 8 mots maximum, ce que le joueur devrait entendre si shouldSpeak."),
});

export type GateDecisionRaw = z.infer<typeof decisionSchema>;

// Self-hosted decision provider (YGG-248): one OpenAI-compatible adapter for
// Ollama, LM Studio, vLLM, llama.cpp server…
const GATE_LOCAL_BASE_URL = process.env.GATE_LOCAL_BASE_URL ?? "http://127.0.0.1:11434/v1";
const GATE_LOCAL_MODEL = process.env.GATE_LOCAL_MODEL ?? "clef-flash";
const GATE_LOCAL_API_KEY = process.env.GATE_LOCAL_API_KEY;
const GATE_TIMEOUT_MS = Number(process.env.GATE_TIMEOUT_MS ?? 60_000);

const GATE_SYSTEM_PROMPT = `
Tu es le filtre de décision de SkyGuide (assistant temps réel pour joueur aveugle de Skyrim).
On te montre un extrait vidéo du jeu, l'historique de ce qui a déjà été dit au joueur,
et parfois l'état du mod (santé, ennemis, combat).

Ta décision : le joueur doit-il ENTENDRE quelque chose MAINTENANT ?

Défaut : SILENCE. Le silence est la bonne réponse dans la grande majorité des cas.

FILTRE DE NOUVEAUTÉ (décisif) :
- même objet, même direction, même distance, même situation → déjà su → SILENCE
- parle uniquement si au moins un critère est vrai : pas d'historique / nouvel objet /
  mouvement ou changement de distance / danger nouveau ou croissant / interaction possible
  maintenant / le joueur fait une erreur / urgence

DÉCLENCHEURS VALIDES :
1. danger immédiat (ennemi qui attaque ou très proche, piège, feu, chute)
2. interaction immédiate (porte, levier, coffre, objet à portée)
3. navigation critique (obstacle, tournant obligatoire)
4. changement majeur (nouvelle zone, nouvel ennemi, aggravation)

SCORES :
- silence : rien de nouveau ou d'utile
- minor : exactitude sympathique mais pas nécessaire (NE PAS parler par défaut)
- useful : navigation ou interaction utile maintenant
- critical : danger, combat, urgence

Si tu ne vois pas clairement le clip : shouldSpeak=false, confidence ≤ 0.3.
Réponds en JSON strict conforme au schéma (pas de texte autour).
`;

function historyText(history: string[]): string {
	if (history.length === 0) {
		return "Historique vide — première prise de parole possible (mode initialisation).";
	}
	return `Déjà dit au joueur (NE PAS répéter) :\n${history.map((line) => `- ${line}`).join("\n")}`;
}

function decisionSystemMessages(
	opts: ExperimentalDecideOptions,
): SystemModelMessage[] {
	const system: SystemModelMessage[] = [
		{ role: "system", content: GATE_SYSTEM_PROMPT },
	];
	if (opts.modContext) {
		system.push({
			role: "system",
			content: `## ÉTAT DU MOD SKYRIM (temps réel)\n${opts.modContext}`,
		});
	}
	system.push({
		role: "system",
		content: historyText(opts.history ?? []),
	});
	if (opts.question) {
		system.push({
			role: "system",
			content: "## MODE QUESTION\nLe joueur pose une question explicite : shouldSpeak=true, category=question.",
		});
	}
	return system;
}

function geminiUserMessage(
	videoBuffer: Buffer,
	mediaType: string,
	opts: ExperimentalDecideOptions,
): UserModelMessage {
	return {
		role: "user",
		content: [
			{ type: "file", data: videoBuffer, mediaType },
			{
				type: "text",
				text: opts.question
					? `Question du joueur : « ${opts.question} »`
					: "Décision :",
			},
		],
	};
}

async function geminiGate(
	videoBuffer: Buffer,
	mediaType: string,
	opts: ExperimentalDecideOptions,
): Promise<GateResult> {
	const start = Date.now();
	const { output } = await generateText({
		model: GEMINI_MODEL,
		output: Output.object({ schema: decisionSchema, name: "skyguide_gate" }),
		abortSignal: AbortSignal.timeout(GATE_TIMEOUT_MS),
		// Google provider: system role goes through `instructions`, never
		// inside `messages` (Invalid prompt otherwise).
		instructions: decisionSystemMessages(opts),
		messages: [geminiUserMessage(videoBuffer, mediaType, opts)],
	});
	return {
		decision: decisionSchema.parse(output),
		provenance: {
			engine: "gemini",
			modelId: GEMINI_MODEL_ID,
			latencyMs: Date.now() - start,
		},
	};
}

function extractJson(text: string): unknown {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start === -1 || end <= start) {
		throw new Error("local gate returned no JSON object");
	}
	return JSON.parse(text.slice(start, end + 1));
}

async function localGate(
	videoBuffer: Buffer,
	mediaType: string,
	opts: ExperimentalDecideOptions,
): Promise<GateResult> {
	const start = Date.now();
	const provider = createOpenAICompatible({
		name: "gate-local",
		baseURL: GATE_LOCAL_BASE_URL,
		apiKey: GATE_LOCAL_API_KEY ?? "not-needed",
	});

	// Not every self-hosted stack accepts video inline; vision-capable models
	// behind Ollama/LM Studio accept base64 data URLs. Failure here surfaces
	// as an unavailable engine in the eval matrix (honest signal).
	const dataUrl = `data:${mediaType};base64,${videoBuffer.toString("base64")}`;

	const { text } = await generateText({
		model: provider(GATE_LOCAL_MODEL),
		abortSignal: AbortSignal.timeout(GATE_TIMEOUT_MS),
		messages: [
			...decisionSystemMessages(opts),
			{
				role: "user",
				content: [
					{ type: "image", image: dataUrl },
					{
						type: "text",
						text: opts.question
							? `Question du joueur : « ${opts.question} »`
							: "Décide (JSON strict selon le schéma système).",
					},
				],
			},
		],
	});

	const decision = decisionSchema.parse(extractJson(text));
	return {
		decision,
		provenance: {
			engine: "local",
			modelId: GATE_LOCAL_MODEL,
			latencyMs: Date.now() - start,
		},
	};
}

/** Defensive coercion of the fixture/live mod context for the rules engine. */
function coerceGameState(raw: unknown): GameStateData | null {
	if (!raw || typeof raw !== "object") return null;
	const candidate = raw as Partial<GameStateData>;
	if (!candidate.player || typeof candidate.player !== "object") return null;
	return candidate as GameStateData;
}

function rulesGate(opts: ExperimentalDecideOptions): GateResult {
	const start = Date.now();

	if (opts.question) {
		return {
			decision: {
				shouldSpeak: true,
				isNew: true,
				relevance: "critical",
				category: "question",
				confidence: 1,
				summary: "Répondre à la question du joueur.",
			},
			provenance: { engine: "rules", modelId: "rules", latencyMs: Date.now() - start },
		};
	}

	const state = coerceGameState(opts.modContext);
	if (!state) {
		// Clip-blind by design: no mod context, no evidence, no speech.
		return {
			decision: {
				shouldSpeak: false,
				isNew: false,
				relevance: "silence",
				category: "change",
				confidence: 0.3,
				summary: "",
			},
			provenance: { engine: "rules", modelId: "rules", latencyMs: Date.now() - start },
		};
	}

	const reflex = evaluateReflex(state);
	if (reflex) {
		return {
			decision: {
				shouldSpeak: true,
				isNew: true,
				relevance: "critical",
				category: reflex.category,
				confidence: 1,
				summary: reflex.text,
			},
			provenance: { engine: "rules", modelId: "rules", latencyMs: Date.now() - start },
		};
	}

	if (state.combatState > 0) {
		return {
			decision: {
				shouldSpeak: true,
				isNew: true,
				relevance: "useful",
				category: "danger",
				confidence: 0.7,
				summary: "Combat en cours.",
			},
			provenance: { engine: "rules", modelId: "rules", latencyMs: Date.now() - start },
		};
	}

	return {
		decision: {
			shouldSpeak: false,
			isNew: false,
			relevance: "silence",
			category: "change",
			confidence: 0.6,
			summary: "",
		},
		provenance: { engine: "rules", modelId: "rules", latencyMs: Date.now() - start },
	};
}

export interface ExperimentalDecideOptions {
	/** Observation history already told to the player. */
	history?: string[];
	/** Mod context text (parseSkyrimState output) or raw JSON. */
	modContext?: string | Record<string, unknown> | null;
	/** Explicit player question — bypasses the silence default. */
	question?: string;
}

/**
 * System 1 entry point: should the player hear something about this clip?
 * Never composes prose — hand `decision.summary` to a composer when speaking.
 */
export async function experimental_decide(
	videoBuffer: Buffer,
	mediaType: string,
	engine: GateEngineId,
	opts: ExperimentalDecideOptions = {},
): Promise<GateResult> {
	switch (engine) {
		case "gemini":
			return geminiGate(videoBuffer, mediaType, opts);
		case "local":
			return localGate(videoBuffer, mediaType, opts);
		case "rules":
			return rulesGate(opts);
		default: {
			const exhaustive: never = engine;
			throw new Error(`Unknown gate engine: ${String(exhaustive)}`);
		}
	}
}

export interface GatePolicy {
	/** Lowest relevance class that may speak. Default "useful". */
	speakFrom?: GateRelevance;
	/** Minimum confidence to speak. Default 0.5. */
	minConfidence?: number;
}

const RELEVANCE_RANK: Record<GateRelevance, number> = {
	silence: 0,
	minor: 1,
	useful: 2,
	critical: 3,
};

/**
 * Escalation policy: calibrated thresholds turn a raw gate decision into the
 * final speak/silence call. Speak requires: the model wants to speak, the
 * information is new, relevance clears the configured class, and confidence
 * clears the configured floor.
 */
export function applyGatePolicy(
	decision: GateDecision,
	policy: GatePolicy = {},
): { speak: boolean; reason: string } {
	const speakFrom = policy.speakFrom ?? "useful";
	const minConfidence = policy.minConfidence ?? 0.5;

	if (!decision.shouldSpeak) {
		return { speak: false, reason: "gate says silence" };
	}
	if (!decision.isNew) {
		return { speak: false, reason: "not new (novelty filter)" };
	}
	if (RELEVANCE_RANK[decision.relevance] < RELEVANCE_RANK[speakFrom]) {
		return { speak: false, reason: `relevance ${decision.relevance} below ${speakFrom}` };
	}
	if (decision.confidence < minConfidence) {
		return {
			speak: false,
			reason: `confidence ${decision.confidence.toFixed(2)} below ${minConfidence}`,
		};
	}
	return { speak: true, reason: "policy allows speech" };
}

export interface GateProbe {
	available: boolean;
	detail: string;
}

/** Availability probe used by the eval matrix and the engines API. */
export async function probeGate(engine: GateEngineId): Promise<GateProbe> {
	if (engine === "rules") {
		return { available: true, detail: "heuristic on mod context" };
	}
	if (engine === "gemini") {
		return { available: true, detail: GEMINI_MODEL_ID };
	}
	// OpenAI-compatible servers expose a /models listing — one cheap request
	// tells us whether the self-hosted decision provider is up.
	try {
		const url = `${GATE_LOCAL_BASE_URL.replace(/\/+$/, "")}/models`;
		const res = await fetch(url, { signal: AbortSignal.timeout(1200) });
		return res.ok
			? { available: true, detail: `${GATE_LOCAL_MODEL} at ${GATE_LOCAL_BASE_URL}` }
			: { available: false, detail: `${url} responded ${res.status}` };
	} catch (err) {
		return {
			available: false,
			detail: `no decision model at ${GATE_LOCAL_BASE_URL} (${err instanceof Error ? err.message : String(err)})`,
		};
	}
}
