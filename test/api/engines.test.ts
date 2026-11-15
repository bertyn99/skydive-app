import { $serverFetch } from "nitro-test-utils";
import { describe, expect, it } from "vitest";

interface EnginesAvailability {
	tts: Array<{ engine: string }>;
	stt: Array<{ engine: string }>;
	composer: Array<{ engine: string }>;
}

interface EngineConfig {
	pipeline: string;
	composerEngine: string;
	profile: string;
}

describe("engines api (integration, nitro-test-utils)", () => {
	it("lists composer engines alongside tts/stt", async () => {
		const res = await $serverFetch<EnginesAvailability>("/api/engines/availability");
		expect(res.status).toBe(200);
		if (!res.data) throw new Error("empty availability body");
		expect(res.data.composer.map((e) => e.engine)).toEqual(["gemini-cloud", "local"]);
		expect(res.data.tts.length).toBeGreaterThan(0);
		expect(res.data.stt.length).toBeGreaterThan(0);
	});

	it("exposes composer engine + derived profile in config", async () => {
		const res = await $serverFetch<EngineConfig>("/api/config");
		expect(res.status).toBe(200);
		if (!res.data) throw new Error("empty config body");
		expect(res.data.pipeline).toBe("fused");
		expect(res.data.composerEngine).toBe("gemini-cloud");
		expect(["offline", "cloud", "custom"]).toContain(res.data.profile);
	});
});
