import { google } from "@ai-sdk/google";
import { type SystemModelMessage, generateObject } from "ai";
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
		.nullable(z.string())
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
		.optional(
			z.array(
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
			),
		)
		.describe("Actions suggérées dans le jeu, si pertinent."),
});

export type GeminiResponse = z.infer<typeof responseSchema>;

interface HistoryEntry {
	userPrompt: string;
	assistantAnswer: string;
}

const MAX_HISTORY = 5;
const history: HistoryEntry[] = [];

export function clearHistory() {
	history.length = 0;
}

export async function describeVideo(
	videoBuffer: Buffer,
	systemPrompt?: string,
	connector?: SkyrimConnector,
	userQuestion?: string,
): Promise<{ response: GeminiResponse; isQuestion: boolean }> {
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
	const userText = userQuestion
		? `« ${userQuestion} »\nRéponds à ma question en te basant sur ce que tu vois.`
		: "Donne moi une update.";

	// Build message history as user/assistant pairs + current turn
	const messages: Array<{
		role: "user" | "assistant";
		content:
			| string
			| Array<{
					type: string;
					text?: string;
					data?: Buffer;
					mediaType?: string;
			  }>;
	}> = [];

	for (const entry of history) {
		messages.push({ role: "user", content: entry.userPrompt });
		messages.push({ role: "assistant", content: entry.assistantAnswer });
	}

	// Current turn with video
	messages.push({
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
	});

	console.log(
		`[gemini] Sending video. History: ${history.length} turns. Prompt: ${userText.slice(0, 80)}`,
	);

	const { object } = await generateObject({
		model: google("gemini-3.1-flash-lite-preview"),
		schema: responseSchema,
		system: system,
		messages: messages as Parameters<typeof generateObject>[0]["messages"],
	});

	// Store in history only if the answer was relevant
	if (object.relevance >= 4 && object.observation) {
		history.push({
			userPrompt: userText,
			assistantAnswer: object.observation,
		});
		if (history.length > MAX_HISTORY) {
			history.shift();
		}
	}

	return { response: object, isQuestion: !!userQuestion };
}
