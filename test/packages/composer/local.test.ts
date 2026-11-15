import { afterEach, describe, expect, it, vi } from "vitest";
import { composeLocal } from "../../../server/packages/composer/providers/local";

// OpenAI-compatible chat response carrying the composer JSON contract.
function chatCompletion(content: object) {
	return {
		id: "mock-1",
		object: "chat.completion",
		choices: [
			{
				index: 0,
				message: { role: "assistant", content: JSON.stringify(content) },
				finish_reason: "stop",
			},
		],
		usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
	};
}

const validOutput = {
	observation: "Ennemi devant vous, à dix pas.",
	unreadable: false,
	relevance: 7,
	actions: [],
};

describe("composeLocal", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("sends system blocks + the clip and parses the observation", async () => {
		const fetchMock = vi.fn(async () =>
			new Response(JSON.stringify(chatCompletion(validOutput)), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await composeLocal({
			clip: { buffer: Buffer.from("fake-webm"), mediaType: "video/webm" },
			history: ["Vous êtes entré."],
			intention: { summary: "Combat imminent" },
		});

		// Provenance: the local model id names what composed.
		expect(result.modelId).toBe("qwen2.5vl:7b");
		expect(result.observation).toBe("Ennemi devant vous, à dix pas.");
		expect(result.unreadable).toBe(false);
		expect(result.relevance).toBe(7);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			{ method: string; body: string },
		];
		expect(url).toContain("/chat/completions");
		expect(init.method).toBe("POST");

		const body = JSON.parse(init.body) as {
			messages: Array<{ role: string; content: unknown }>;
		};

		// ai@7 rejects system messages without allowSystemInMessages — the
		// request reaching the wire proves the opt-in works.
		expect(body.messages[0]?.role).toBe("system");
		const roles = body.messages.map((m) => m.role);
		expect(roles.every((r) => r === "system" || r === "user")).toBe(true);

		// The clip rides as a `video_url` content part (ai@7 serializes
		// image/file parts with a video/* data URL this way); history and
		// intention ride along as system text.
		const userMessage = body.messages.at(-1) as {
			role: string;
			content: Array<{ type: string; video_url?: { url: string } }>;
		};
		const videoPart = userMessage.content[0];
		expect(videoPart?.type).toBe("video_url");
		expect(videoPart?.video_url?.url).toMatch(/^data:video\/webm;base64,/);
		const serialized = JSON.stringify(body);
		expect(serialized).toContain("Vous êtes entré.");
		expect(serialized).toContain("Combat imminent");
	});

	it("surfaces an unreadable-clip verdict from the model", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				new Response(
					JSON.stringify(
						chatCompletion({
							observation: "Je ne vois pas clairement, restez immobile une seconde.",
							unreadable: true,
							relevance: 2,
							actions: [],
						}),
					),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			),
		);

		const result = await composeLocal({
			clip: { buffer: Buffer.from("dark-frames"), mediaType: "video/webm" },
			history: [],
		});
		expect(result.unreadable).toBe(true);
		expect(result.observation).toContain("restez immobile");
	});

	it("rejects schema-violating model output", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				new Response(
					JSON.stringify(
						chatCompletion({ observation: "x", unreadable: false, relevance: 42 }),
					),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			),
		);

		await expect(
			composeLocal({ clip: { buffer: Buffer.from("c"), mediaType: "video/webm" }, history: [] }),
		).rejects.toThrow();
	});

	it("rejects on HTTP 500 from the local server", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("boom", { status: 500 })),
		);

		await expect(
			composeLocal({ clip: { buffer: Buffer.from("c"), mediaType: "video/webm" }, history: [] }),
		).rejects.toThrow();
	});

	it("rejects on non-JSON model prose", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				new Response(
					JSON.stringify(chatCompletion({ note: "Je ne peux pas répondre en JSON." })),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			),
		);

		await expect(
			composeLocal({ clip: { buffer: Buffer.from("c"), mediaType: "video/webm" }, history: [] }),
		).rejects.toThrow();
	});

	it("rejects when the call times out", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new DOMException("This operation was aborted", "AbortError");
			}),
		);

		await expect(
			composeLocal({ clip: { buffer: Buffer.from("c"), mediaType: "video/webm" }, history: [] }),
		).rejects.toThrow();
	});
});
