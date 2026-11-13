// Shared voice-engine configuration (STT side). Kept in its own module so the
// local runners (whisper-server sidecar, parakeet-cli) and the model catalog
// can agree on the endpoint and listening language without import cycles.
export const WHISPER_STT_URL = process.env.WHISPER_STT_URL ?? "http://127.0.0.1:8080/inference";
export const WHISPER_STT_LANGUAGE = process.env.WHISPER_STT_LANGUAGE ?? "fr";
export const WHISPER_STT_TIMEOUT_MS = Number(process.env.WHISPER_STT_TIMEOUT_MS ?? 8000);
