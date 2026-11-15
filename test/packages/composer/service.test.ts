import { afterEach, describe, expect, it, vi } from "vitest";
import {
	COMPOSER_ENGINE_IDS,
	compose,
	composerEngineLabel,
	defaultComposerEngine,
	isComposerEngineId,
	resolveComposerEngine,
} from "../../../server/packages/composer/service";

const input = {
	clip: { buffer: Buffer.from("clip"), mediaType: "video/webm" },
	history: [],
};

// Stubs leak across files in the shared worker (isolate: false) — always
// clean up, from every describe block.
afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("engine id helpers", () => {
	it("narrow untrusted values", () => {
		expect(isComposerEngineId("local")).toBe(true);
		expect(isComposerEngineId("gemini-cloud")).toBe(true);
		expect(isComposerEngineId("gemini")).toBe(false);
		expect(isComposerEngineId(undefined)).toBe(false);
		expect(resolveComposerEngine("bogus", "local")).toBe("local");
		expect(resolveComposerEngine("gemini-cloud", "local")).toBe("gemini-cloud");
	});

	it("labels come from the registry", () => {
		for (const id of COMPOSER_ENGINE_IDS) {
			expect(composerEngineLabel(id)).toBeTruthy();
		}
	});

	it("COMPOSER_ENGINE beats the chain default", () => {
		vi.stubEnv("COMPOSER_CHAIN", "");
		vi.stubEnv("COMPOSER_ENGINE", "local");
		expect(defaultComposerEngine()).toBe("local");
		vi.stubEnv("COMPOSER_ENGINE", "bogus");
		expect(defaultComposerEngine()).toBe("gemini-cloud");
	});

	it("COMPOSER_CHAIN overrides the default chain order", () => {
		vi.stubEnv("COMPOSER_ENGINE", "");
		vi.stubEnv("COMPOSER_CHAIN", "local");
		expect(defaultComposerEngine()).toBe("local");
	});
});

describe("compose()", () => {
	it("returns null when every engine in the chain fails", async () => {
		vi.stubEnv("COMPOSER_CHAIN", "local,gemini-cloud");
		// Probe-gating requires the gemini probe to pass, else it's skipped
		// before the attempt — key stub keeps the full chain in play.
		vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
			}),
		);

		const result = await compose(input, "local");
		expect(result).toBeNull();
	});

	it("skips chain entries whose probe reports unavailable", async () => {
		// Pinned empty (the global setup loads the real .env, where the key
		// exists) → gemini-cloud probe fails → its leg is never fetched.
		vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
		vi.stubEnv("COMPOSER_CHAIN", "local,gemini-cloud");
		const fetchMock = vi.fn(async (_url: unknown) => {
			throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await compose(input, "local");
		expect(result).toBeNull();
		const targets = fetchMock.mock.calls.map((c) => String(c[0]));
		expect(targets.every((t) => t.includes("/chat/completions"))).toBe(true);
	});

	it("returns provenance naming the engine that actually composed", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									role: "assistant",
									content: JSON.stringify({
										observation: "Porte à gauche.",
										unreadable: false,
										relevance: 6,
										actions: [],
									}),
								},
							},
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			),
		);

		const result = await compose(input, "local");
		expect(result).not.toBeNull();
		expect(result?.provenance.engine).toBe("local");
		expect(result?.provenance.fallbackFrom).toBeNull();
		expect(result?.provenance.latencyMs).toBeGreaterThanOrEqual(0);
		expect(result?.observation).toBe("Porte à gauche.");
	});

	it("falls down the chain and names the requested engine as fallbackFrom", async () => {
		vi.stubEnv("COMPOSER_CHAIN", "local,gemini-cloud");
		// Probe-gated chain: the gemini leg runs only when its probe passes.
		vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
		const observation = JSON.stringify({
			observation: "Sortie à droite.",
			unreadable: false,
			relevance: 6,
			actions: [],
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: unknown) => {
				const target = String(url);
				if (target.includes("/chat/completions")) {
					// Local leg down — the whole reason a chain exists.
					throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
				}
				if (target.includes("generativelanguage")) {
					return new Response(
						JSON.stringify({
							candidates: [
								{
									content: { parts: [{ text: observation }], role: "model" },
									finishReason: "STOP",
								},
							],
							usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
						}),
						{ status: 200, headers: { "content-type": "application/json" } },
					);
				}
				throw new Error(`unexpected fetch target: ${target}`);
			}),
		);

		const result = await compose(input, "local");
		expect(result).not.toBeNull();
		expect(result?.provenance.engine).toBe("gemini-cloud");
		expect(result?.provenance.fallbackFrom).toBe("local");
		expect(result?.observation).toBe("Sortie à droite.");
	});
});
