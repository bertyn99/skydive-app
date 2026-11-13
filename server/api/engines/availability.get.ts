import { defineEventHandler } from "h3";
import { probeWhisper } from "../../voice";
import {
	COMPOSER_ENGINE_IDS,
	probeComposerEngine,
	type ComposerEngineId,
} from "../../composer";
import {
	TTS_ENGINE_IDS,
	probeTtsEngine,
	ttsEngineLabel,
	type TtsEngineId,
} from "../../voice";

export interface EngineAvailability {
	engine: string;
	/** Human label from the TTS service registry. */
	label?: string;
	available: boolean;
	detail: string;
	/** Setup steps offered in the dashboard when unavailable. */
	setupHint?: string;
}

export interface EnginesAvailability {
	tts: EngineAvailability[];
	stt: EngineAvailability[];
	composer: EngineAvailability[];
}

function probeApiKeyEngine(
	engine: string,
	envVar: string,
	what: string,
): EngineAvailability {
	const hasKey = Boolean(process.env[envVar]);
	return {
		engine,
		available: hasKey,
		detail: hasKey ? `${envVar} set` : `${envVar} missing — ${what} unavailable`,
		setupHint: hasKey ? undefined : `Set ${envVar} in .env`,
	};
}

async function probeTtsEntry(id: TtsEngineId): Promise<EngineAvailability> {
	const probe = await probeTtsEngine(id);
	return {
		engine: id,
		label: ttsEngineLabel(id),
		available: probe.available,
		detail: probe.detail,
		setupHint: probe.setupHint,
	};
}

async function probeComposerEntry(id: ComposerEngineId): Promise<EngineAvailability> {
	const probe = await probeComposerEngine(id);
	return {
		engine: id,
		available: probe.available,
		detail: probe.detail,
		setupHint: probe.setupHint,
	};
}

export default defineEventHandler(async (): Promise<EnginesAvailability> => {
	// The TTS list comes straight from the service registry — platform-gated
	// engines (voipi-macos) simply probe unavailable off their platform.
	const [whisper, tts, composer] = await Promise.all([
		probeWhisper(),
		Promise.all(TTS_ENGINE_IDS.map((id) => probeTtsEntry(id))),
		Promise.all(COMPOSER_ENGINE_IDS.map((id) => probeComposerEntry(id))),
	]);

	return {
		tts,
		stt: [
			probeApiKeyEngine("elevenlabs", "ELEVENLABS_API_KEY", "cloud STT"),
			{ engine: "whisper-local", ...whisper },
		],
		composer,
	};
});
