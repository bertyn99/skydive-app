// server/voice — public API of the voice module.
//
// Everything outside this module (engine.ts, API routes, future Electron
// main) imports from here only. Internal layout is free to change:
//
//   tts/service.ts          registry + per-platform fallback chains
//   tts/providers/*         one file per engine (say.darwin.ts = platform-gated)
//   stt/service.ts          transcribe seam (cloud ↔ local router)
//   stt/local/*             pinned catalog, installer, sidecar + CLI runners
//   config.ts               shared env + probe/voice helpers
//
// Platform-specific providers live in files suffixed like Electron builds
// (.darwin.ts) and are gated in the registries via `platforms`.

// --- TTS service ---
export {
	TTS_ENGINE_IDS,
	defaultTtsEngine,
	isTtsEngineId,
	probeTtsEngine,
	resolveTtsEngine,
	synthesizeSpeech,
	ttsEngineLabel,
	type TtsEngineId,
	type TtsEngineProbe,
	type TtsProvenance,
	type TtsResult,
} from "./tts/service";

// --- STT service ---
export {
	STT_ENGINE_IDS,
	isSttEngineId,
	resolveSttEngine,
	transcribeSpeech,
	type SttEngineId,
	type SttProvenance,
	type SttResult,
} from "./stt/service";

// --- STT local runners (whisper/parakeet) ---
export {
	activeLocalRunner,
	probeWhisper,
} from "./stt/local/router";
export {
	bestInstalledModel,
	installWhisperModel,
	listWhisperModels,
	modelsDir,
	recommendedModelIdForLanguage,
	removeWhisperModel,
	resolveVerifiedModelPath,
	whisperInstallState,
	whisperLastInstallError,
	type WhisperInstallState,
	type WhisperModelReport,
	type WhisperModelSpec,
	type WhisperModelStatus,
} from "./stt/local/catalog";
export {
	probeFfmpeg,
	resolveWhisperServerBinary,
	startWhisperServer,
	stopWhisperServer,
	whisperServerStatus,
	type WhisperServerStatus,
} from "./stt/local/whisper-sidecar";

// --- Shared config + probe shape ---
export {
	type EngineProbe,
	listeningLanguage,
	WHISPER_STT_LANGUAGE,
	WHISPER_STT_TIMEOUT_MS,
	WHISPER_STT_URL,
} from "./config";
