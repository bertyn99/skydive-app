import { describe, expect, it } from "vitest";
import {
	composeSchema,
	composerSystemMessages,
	composerUserText,
	parseComposerJson,
	type ComposeInput,
} from "../../../server/packages/composer/config";

function makeInput(overrides: Partial<ComposeInput> = {}): ComposeInput {
	return {
		clip: { buffer: Buffer.from("clip"), mediaType: "video/webm" },
		history: [],
		...overrides,
	};
}

describe("composeSchema", () => {
	it("accepts a full observation and defaults optional fields", () => {
		const parsed = composeSchema.parse({
			observation: "Ennemi devant vous.",
			unreadable: false,
			relevance: 7,
		});
		expect(parsed.observation).toBe("Ennemi devant vous.");
		expect(parsed.unreadable).toBe(false);
		expect(parsed.actions).toEqual([]);
	});

	it("rejects relevance out of range", () => {
		expect(() =>
			composeSchema.parse({ observation: "x", unreadable: false, relevance: 11 }),
		).toThrow();
	});

	it("allows null observation for unreadable clips", () => {
		const parsed = composeSchema.parse({
			observation: null,
			unreadable: true,
			relevance: 1,
		});
		expect(parsed.observation).toBeNull();
		expect(parsed.unreadable).toBe(true);
	});
});

describe("parseComposerJson", () => {
	it("parses a plain JSON object", () => {
		const parsed = parseComposerJson(
			'{"observation":"Cible devant.","unreadable":false,"relevance":6,"actions":[]}',
		);
		expect(parsed.observation).toBe("Cible devant.");
		expect(parsed.relevance).toBe(6);
	});

	it("parses JSON wrapped in markdown fences or prose", () => {
		const parsed = parseComposerJson(
			'Voici :\n```json\n{"observation":"Bloc.","unreadable":false,"relevance":5}\n```',
		);
		expect(parsed.observation).toBe("Bloc.");
	});

	it("throws when no JSON object is present", () => {
		expect(() => parseComposerJson("Aucune donnée exploitable ici.")).toThrow();
	});

	it("rejects schema violations from the model", () => {
		expect(() =>
			parseComposerJson('{"observation":"x","unreadable":false,"relevance":99}'),
		).toThrow();
	});

	it("finds the balanced object when prose contains stray braces", () => {
		const parsed = parseComposerJson(
			'Analyse {en cours} du clip : {"observation":"Vue du donjon.","unreadable":false,"relevance":5}',
		);
		expect(parsed.observation).toBe("Vue du donjon.");
	});

	it("keeps brace characters inside string values intact", () => {
		const parsed = parseComposerJson(
			'{"observation":"Symbole affiché : {X}","unreadable":false,"relevance":4}',
		);
		expect(parsed.observation).toBe("Symbole affiché : {X}");
	});

	it("throws when braces never balance", () => {
		expect(() => parseComposerJson('{"observation":"tronqué', )).toThrow();
	});
});

describe("composerSystemMessages", () => {
	it("always includes the composer rules prompt", () => {
		const messages = composerSystemMessages(makeInput());
		expect(messages).toHaveLength(1);
		expect(messages[0]?.content).toContain("compositeur de SkyGuide");
	});

	it("puts the operator override before the rules", () => {
		const messages = composerSystemMessages(
			makeInput({ systemPrompt: "Tu es un guide de donjon." }),
		);
		expect(messages[0]?.content).toBe("Tu es un guide de donjon.");
		expect(messages[1]?.content).toContain("compositeur de SkyGuide");
	});

	it("keeps trusted content at system level and question mode as an instruction", () => {
		const messages = composerSystemMessages(
			makeInput({ history: ["Vous êtes entré."], question: "Combien ?" }),
		);
		const contents = messages.map((m) => m.content).join("\n");
		expect(contents).toContain("- Vous êtes entré.");
		expect(contents).toContain("MODE QUESTION");
	});

	it("moves mod context and gate intention out of system (untrusted data)", () => {
		const messages = composerSystemMessages(
			makeInput({
				modContext: "hp=42; enemies=1",
				intention: { summary: "Combat imminent" },
			}),
		);
		const contents = messages.map((m) => m.content).join("\n");
		// Neither may speak with system authority — both are model/game data.
		expect(contents).not.toContain("hp=42; enemies=1");
		expect(contents).not.toContain("Combat imminent");
	});

	it("frames user text as untrusted game data plus the phrasing task", () => {
		const text = composerUserText(
			makeInput({
				modContext: "hp=42; enemies=1",
				intention: { summary: "Combat imminent" },
			}),
		);
		expect(text).toContain("NON FIABLE");
		expect(text).toContain("hp=42; enemies=1");
		expect(text).toContain("« Combat imminent »");
		expect(text).toContain("Formule l'observation");
	});

	it("user text carries the question in question mode", () => {
		const text = composerUserText(makeInput({ question: "Combien d'ennemis ?" }));
		expect(text).toContain("Combien d'ennemis ?");
		expect(text).not.toContain("Formule l'observation");
	});

	it("skips empty history and absent intention", () => {
		const messages = composerSystemMessages(makeInput({ history: [] }));
		expect(messages).toHaveLength(1);
	});
});
