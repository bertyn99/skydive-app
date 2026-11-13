import { defineEventHandler } from "h3";
import { probePiper } from "../../utils/piper-tts";
import { probeWhisper } from "../../utils/whisper-stt";

export interface EngineAvailability {
	engine: string;
	available: boolean;
	detail: string;
	/** Setup steps offered in the dashboard when unavailable. */
	setupHint?: string;
}

export interface EnginesAvailability {
	tts: EngineAvailability[];
	stt: EngineAvailability[];
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

export default defineEventHandler(async (): Promise<EnginesAvailability> => {
	const [piper, whisper] = await Promise.all([probePiper(), probeWhisper()]);

	return {
		tts: [
			probeApiKeyEngine("elevenlabs", "ELEVENLABS_API_KEY", "cloud TTS"),
			probeApiKeyEngine("mistral", "MISTRAL_API_KEY", "cloud TTS"),
			{ engine: "piper-local", ...piper },
		],
		stt: [
			probeApiKeyEngine("elevenlabs", "ELEVENLABS_API_KEY", "cloud STT"),
			{ engine: "whisper-local", ...whisper },
		],
	};
});
