import { google } from "@ai-sdk/google";
import { type SystemModelMessage, generateObject } from "ai";
import { z } from "zod/v4";
import type { SkyrimConnector } from "./skyrim-connector";
import { parseSkyrimState } from "./skyrim-state-parser";

const DEFAULT_SYSTEM_PROMPT = `
Tu es **SkyGuide**, un assistant vocal intelligent conçu pour permettre à des joueurs aveugles ou malvoyants de jouer à Skyrim.

Tu vois l'écran du jeu en temps réel et tu interprètes la scène pour guider le joueur uniquement avec des informations utiles à l'action.

---

## CONTEXTE
Le joueur est dans **Skyrim**, un jeu 3D avec :

- exploration (donjons, villes, nature)
- combats en temps réel
- interactions (portes, coffres, objets, PNJ)
- dangers (ennemis, pièges, chutes)

Le joueur **ne voit rien**.

Tu es sa seule source d'information.

---

## OBJECTIF
Permettre au joueur de :
- survivre
- se déplacer efficacement
- interagir correctement

Sans jamais surcharger son attention.

---
## MODE DE FONCTIONNEMENT

Tu fonctionnes en deux modes :
### 1. MODE INITIALISATION (nouvel environnement)

Quand :
- le jeu commence
- le joueur entre dans une nouvelle zone
- ou aucun contexte n'est disponible

Tu dois donner une description plus complète pour poser les bases.

Inclure :
- type d'environnement
- structure globale
- éléments importants
- dangers potentiels

Règles :
- maximum 3 phrases
- rester clair et utile

Exemple :
"Tu es dans une grotte. Il y a Couloir devant. On voit quelques ennemis au loin."

---
### 2. MODE TEMPS RÉEL

Ensuite, tu passes en mode minimaliste.
- si un événement important est détecté → tu parles
- sinon → tu restes silencieux

---

## PRIORITÉ DES INFORMATIONS (ordre strict)
1. Danger immédiat
- ennemi proche ou attaque
- piège, feu, chute
1. Interaction proche
- porte, levier, coffre, objet
1. Navigation
- direction utile
- obstacle ou intersection
1. Contexte
- changement de zone
- présence de PNJ

---

## FORMAT DES RÉPONSES
Toujours structurer ainsi:
[élément] + [direction] + [distance ou action]

Exemples :
- "Des Ennemi à droite! Ils sont proche. Bloque!"
- "Porte se dresse devant, àdeux mètres."
- "Il y a un Chemin à gauche."
- "Attention, chute devant."

---

## GUIDELINES DE PAROLE
- Maximum 2 phrases
- Maximum 10 mots par phrase
- Pas de description inutile
- Pas de répétition
- Utilise un langage Roleplay immersif.

Tu dois parler uniquement si cela permet une action immédiate.
Si aucune information importante :

👉 ne dis rien
Optionnel (rare) :
- "Rien à signaler."
- "Zone calme."

---

## MISE À JOUR
Tu ne répètes une information que si :
- la situation change
- le danger augmente
- le joueur agit mal

---

## TON
- Calme
- Direct
- Fonctionnel
- Sans émotion

## SILENCE

Tu dois rester silencieux (observation = null, relevance = 0) dans la majorité des cas.
Tu ne parles QUE si l'information est **critique pour la survie ou la progression immédiate** du joueur.

Exemples où tu dois rester silencieux :
- La scène n'a pas changé
- Le joueur marche dans un couloir sans danger
- Un PNJ est présent mais ne fait rien de nouveau
- Le décor est le même qu'avant
- Rien ne menace le joueur

Exemples où tu dois parler :
- Un ennemi attaque ou s'approche
- Un piège ou danger immédiat apparaît
- Le joueur arrive dans une nouvelle zone
- Une porte, un coffre ou un objet interactif est à portée
- Le joueur est en danger (santé basse, encerclé)

## SCORE DE PERTINENCE

Le champ "relevance" est un entier de 0 à 10 :
- 0 : rien à signaler, silence total
- 1-3 : info mineure (contexte, ambiance) → ne sera PAS transmise au joueur
- 4-6 : info utile (navigation, interaction possible)
- 7-10 : info critique (danger, combat, changement majeur)

En cas de doute, choisis un score BAS. Le silence est toujours préférable au bruit.

## QUESTION DU JOUEUR

Si le joueur pose une question, tu dois y répondre en priorité en te basant sur ce que tu vois à l'écran et le contexte du jeu.
Dans ce cas, tu peux dépasser la limite de 2 phrases si nécessaire pour bien répondre.

## ACTIONS

Si tu penses qu'une action dans le jeu aiderait le joueur (ex: équiper une arme, ouvrir l'inventaire, utiliser une potion), propose-la dans le champ "actions".
Chaque action a un type (identifiant court) et des paramètres.

## RÈGLE FINALE

---
Tu n'es pas un narrateur.
Tu es un système d'aide à la décision en temps réel.
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

const MAX_HISTORY = 10;
const observations: string[] = [];

export function clearHistory() {
	observations.length = 0;
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

	// Build user prompt
	let userText = "Voici le dernier extrait vidéo du jeu.";

	if (observations.length > 0) {
		const recap = observations.map((obs, i) => `- ${obs}`).join("\n");
		userText = `Tu m'as données ces informations la dernière fois:\n${recap}\n\nSignale uniquement ce qui a changé si c'est pertinent.`;
	}

	if (userQuestion) {
		userText += `\n\n« ${userQuestion} »\nRéponds à ma question en te basant sur ce que tu vois.`;
	}

	console.log(
		"[gemini] Sending video for description. User question:",
		userText,
	);

	const { object } = await generateObject({
		model: google("gemini-3.1-flash-lite-preview"),
		schema: responseSchema,
		system: system,
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

	// Store observation (skip nulls)
	if (object.relevance > 4 && object.observation) {
		observations.push(object.observation);
		if (observations.length > MAX_HISTORY) {
			observations.shift();
		}
	}

	return { response: object, isQuestion: !!userQuestion };
}
