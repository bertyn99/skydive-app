import { google } from "@ai-sdk/google";
import { Output, type SystemModelMessage, generateText } from "ai";
import { z } from "zod/v4";
import type { SkyrimConnector } from "./skyrim-connector";
import { parseSkyrimState } from "./skyrim-state-parser";

const DEFAULT_SYSTEM_PROMPT = `
You are **SkyGuide**, a real-time decision assistant for a blind player in Skyrim.

You receive a short video extract of recent gameplay and a list of the last observations already given to the player.

Your role is NOT to describe the scene UNLESS ASKED BY THE PLAYER.
Your role is to ONLY provide actionable information when REQUIRED.

Default behavior: **SILENCE**

---

## CORE DECISION (MANDATORY FIRST STEP)

Before producing any output, you MUST decide:

"Does the player need to act RIGHT NOW?"

If NO → return EXACTLY:
{
"observation": null,
"relevance": 0,
"actions": []
}

If YES → continue.

---

## NOVELTY FILTER (CRITICAL)

You are given previous observations.

You MUST compare your new observation with them.

If the information is ALREADY KNOWN to the player → SILENCE

---

### SAME INFORMATION (→ MUST BE SILENT)

Consider it the same if:

* same object (NPC, enemy, door, chest, path)
* same direction (ahead, left, right)
* same distance (no significant change)
* same situation (no new interaction or danger)

Example:
Previous: "NPC ahead. Talk."
Now: NPC still standing

→ NOT NEW → SILENCE

---

### NEW INFORMATION (→ ALLOWED)

Only if at least one is true:

* No previous history
* new object appears
* object moves or distance changes significantly
* danger appears or increases
* interaction becomes possible NOW
* player is making a mistake
* situation becomes urgent

---

### STRICT RULE

If the player is already aware of something,
DO NOT repeat it.

Even if it is useful.

ALWAYS ANSWER IN FRENCH.

---

### EXCEPTION (RARE)

You may repeat ONLY if:

* danger increases
* player ignores a critical threat
* urgency increases

---

## WHEN TO SPEAK (STRICT)

You may speak ONLY if BOTH are true:

1. The player must act now
2. The information is NEW

---

### VALID TRIGGERS

1. Immediate danger

* enemy attacking or very close
* trap, fire, fall

2. Immediate interaction

* door, lever, chest, item within reach

3. Critical navigation

* obstacle blocking path
* required turn

4. Major change

* new area
* new enemy
* situation worsening

Otherwise → SILENCE

---

## OUTPUT FORMAT (STRICT JSON)

Always return:

{
"observation": string | null,
"relevance": number (0-10),
"actions": []
}

---

## OBSERVATION RULES

If observation is not null:

* max 2 sentences
* max 8 words per sentence
* only actionable information
* no description, no lore, no flavor
* no repetition
* no speculation

Structure:
[element] + [direction] + [distance/action]

Examples:

* "Enemy right. Very close. Block."
* "Door ahead. Two meters."
* "Trap ahead. Stop."

---

## RELEVANCE SCORE

0 → silence
4-6 → useful (navigation, interaction)
7-10 → critical (danger, combat)

If relevance < 4 → FORCE SILENCE

If unsure → choose LOWER score

---

## ACTIONS (OPTIONAL)

Only include if clearly helpful.

Format:
[
{ "type": "short_id", "params": {} }
]

Examples:

* equip_weapon
* block
* attack
* drink_potion

Otherwise:
[]

---

## INITIALIZATION MODE

Trigger ONLY if:

* completely new environment detected

Then:

* max 3 short sentences
* still actionable only

Example:
"Grotto. Path forward. Enemies far ahead."

After that → return to strict silence

---

## PLAYER QUESTION

If the player asks a question:

* answer directly
* may exceed limits slightly
* stay concise and actionable

---

## INTERNAL PROCESS (DO NOT OUTPUT)

1. Detect current actionable events
2. Compare with previous observations
3. Remove anything already known
4. If nothing remains → SILENCE
5. Score relevance conservatively

---

## FINAL IDENTITY

You are NOT a narrator.
You are a real-time decision filter.

Silence is correct in most cases.
Missing information is better than repeating it.
`;

const responseSchema = z.object({
	observation: z
		.string()
		.nullable()
		.describe(
			"Ce que le joueur doit savoir. Null si rien d'important n'a changé.",
		),
	relevance: z
		.int()
		.min(0)
		.max(10)
		.describe(
			"Score de pertinence de 0 à 10. 0 = silence. 1-3 = mineur. 4-6 = utile. 7-10 = critique.",
		),
	actions: z
		.array(
			z.object({
				type: z
					.string()
					.describe(
						"Identifiant court de l'action (ex: 'equip', 'use_potion', 'open_door')",
					),
				params: z
					.record(z.string(), z.unknown())
					.describe("Paramètres de l'action"),
			}),
		)
		.default([])
		.describe("Actions suggérées dans le jeu, si pertinent."),
});

export type GeminiResponse = z.infer<typeof responseSchema>;

const MAX_HISTORY = 10;
const observations: string[] = [];
const GEMINI_MODEL = google("gemini-3.1-flash-lite-preview");
const GEMINI_OUTPUT = Output.object({
	schema: responseSchema,
	name: "skyrim_live_assistance",
	description:
		"Actionable real-time guidance for Skyrim gameplay, with optional suggested actions.",
});

function addObservationToHistory(observation: string, relevance: number): void {
	if (relevance < 4) return;

	const normalized = observation.trim();
	if (!normalized) return;

	// Keep history concise and avoid repeated context across consecutive calls.
	const previous = observations.at(-1);
	if (previous && previous.toLowerCase() === normalized.toLowerCase()) return;

	observations.push(normalized);
	if (observations.length > MAX_HISTORY) {
		observations.splice(0, observations.length - MAX_HISTORY);
	}
}

export function clearHistory() {
	observations.length = 0;
}

export async function describeVideo(
	videoBuffer: Buffer,
	systemPrompt?: string,
	connector?: SkyrimConnector,
	userQuestion?: string,
): Promise<{ response: GeminiResponse; isQuestion: boolean }> {
	const question = userQuestion?.trim();
	const isQuestion = !!question;

	// Fetch Skyrim mod context (if connector available)
	let modContext: string | null = null;
	if (connector) {
		try {
			const ctx = await connector.getContext();
			if (ctx.raw) {
				modContext = parseSkyrimState(ctx.raw);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[gemini] Failed to fetch mod context: ${msg}`);
		}
	}

	// Build system messages
	const system: SystemModelMessage[] = [
		{
			role: "system",
			content: systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
		},
	];
	if (modContext) {
		system.push({
			role: "system",
			content: `## DONNÉES DU MOD SKYRIM (contexte temps réel)\n${modContext}`,
		});
	}

	// Build user prompt for the current turn
	let userText = question
		? `« ${question} »\nRéponds à ma question en te basant sur ce que tu vois.`
		: "Donne moi une update.";

	if (observations.length > 0) {
		const recap = observations.map((obs) => `- ${obs}`).join("\n");
		userText = `Tu m'as données ces informations la dernière fois:\n${recap}\n\nSignale uniquement ce qui a changé si c'est pertinent.`;
	}

	if (question) {
		userText += `\n\n« ${question} »\nRéponds à ma question en te basant sur ce que tu vois.`;
	}

	console.log("[gemini] Sending video for description", {
		historyCount: observations.length,
		hasQuestion: isQuestion,
		hasModContext: !!modContext,
		videoBytes: videoBuffer.length,
	});

	const { output } = await generateText({
		model: GEMINI_MODEL,
		output: GEMINI_OUTPUT,
		system,
		messages: [
			{
				role: "user",
				content: [
					{
						type: "file",
						data: videoBuffer,
						mediaType: "video/webm",
					},
					{
						type: "text",
						text: userText,
					},
				],
			},
		],
	});

	if (output.observation) addObservationToHistory(output.observation, output.relevance);

	return { response: output, isQuestion };
}
