// Local TTS via VoiPi's Piper provider (https://github.com/pithings/voipi).
// VoiPi handles the plumbing we used to do by hand: 3-tier binary resolution
// (system `piper` → python module → auto-installed standalone binary), and
// on-demand voice downloads from HuggingFace (rhasspy/piper-voices) cached in
// os.tmpdir()/voipi-piper/. We keep the seam contract: probePiper() for the
// dashboard and textToSpeechPiperLocal() returning base64 WAV for tts.ts.
//
// Voice selection: PIPER_VOICE env override, else the listening language
// (WHISPER_STT_LANGUAGE) picks a voice, else voipi's default.
//
// Config:
//   PIPER_VOICE            voice id, e.g. fr_FR-mls-medium (default: by language)
//   PIPER_TTS_TIMEOUT_MS   per-request timeout (default 20000)
//   PIPER_DEBUG            set to 1 for latency logs
import { Piper } from "voipi/piper";
import { access, constants } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	type EngineProbe,
	voiceForLanguage,
} from "../../config";
import { spawnWorks } from "../../_spawn";

const PIPER_VOICE = process.env.PIPER_VOICE;
const PIPER_TTS_TIMEOUT_MS = Number(process.env.PIPER_TTS_TIMEOUT_MS ?? 20_000);
const PIPER_DEBUG_LOGS = process.env.PIPER_DEBUG === "1";

// Listening language → voice id (voipi's LANG_VOICES picks, en tightened to
// the classic lessac-medium instead of libritts-high: smaller + reliable).
const LANG_VOICES: Record<string, string> = {
	en: "en_US-lessac-medium",
	es: "es_MX-claude-high",
	fr: "fr_FR-mls-medium",
};

function resolvedVoiceId(): string {
	return voiceForLanguage(LANG_VOICES, "en_US-lessac-medium", PIPER_VOICE);
}

// Memoized like voipi's internal ensurePiper: one provider, first synth
// triggers the binary auto-install + voice download.
let providerPromise: Promise<Piper> | undefined;

function getPiper(): Promise<Piper> {
	providerPromise ??= Promise.resolve(new Piper({ voice: resolvedVoiceId() }));
	return providerPromise;
}

async function isExecutable(filePath: string): Promise<boolean> {
	try {
		await access(filePath, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function voipiCachePiper(): string {
	// voipi's cache layout (src/providers/piper.ts): tmpdir()/voipi-piper
	return path.join(tmpdir(), "voipi-piper", "bin", "piper", "piper");
}

/**
 * Availability probe for the dashboard. No side effects: reports which of
 * voipi's tiers is satisfied. On Linux x64/arm64 the binary auto-installs on
 * first use, so "pending auto-install" still counts as available.
 */
export async function probePiper(): Promise<EngineProbe> {
	const voice = resolvedVoiceId();

	if (await spawnWorks("piper", ["--version"])) {
		return { available: true, detail: `piper on PATH, voice ${voice}` };
	}
	for (const py of ["python3", "python"]) {
		if (await spawnWorks(py, ["-m", "piper", "--version"])) {
			return { available: true, detail: `piper via ${py} -m piper, voice ${voice}` };
		}
	}
	if (await isExecutable(voipiCachePiper())) {
		return { available: true, detail: `cached piper binary, voice ${voice}` };
	}
	if (process.platform === "linux" && ["x64", "arm64"].includes(process.arch)) {
		return {
			available: true,
			detail: `voice ${voice} — binary + voice auto-install on first use (voipi)`,
		};
	}
	return {
		available: false,
		detail: "no piper binary and no auto-install path for this platform",
		setupHint: "Install python3 so voipi can create a piper venv, or install piper manually.",
	};
}

/**
 * Synthesize speech with the local piper engine (via VoiPi). Text goes in,
 * base64-encoded WAV comes back. Throws on timeout or failure — the TTS seam
 * (server/voice/tts/service.ts) handles the fallback chain and provenance.
 */
export async function textToSpeechPiperLocal(text: string): Promise<string> {
	const normalizedText = text.trim();
	if (!normalizedText) return "";

	const startedAt = Date.now();
	const signal = AbortSignal.timeout(PIPER_TTS_TIMEOUT_MS);

	const piper = await getPiper();
	const audio = await piper.toAudio(normalizedText, { signal });

	if (!audio.data || audio.data.length === 0) {
		throw new Error(`Piper produced no audio (voice ${resolvedVoiceId()})`);
	}

	if (PIPER_DEBUG_LOGS) {
		const duration = audio.duration ? ` ${audio.duration.toFixed(1)}s wav` : "";
		console.log(
			`[piper-tts] ${Math.round(audio.data.length / 1024)}KB wav${duration} in ${Date.now() - startedAt}ms (voice ${resolvedVoiceId()})`,
		);
	}
	return audio.data.toString("base64");
}
