import type { Peer } from "crossws";
import {
	addToHistory,
	clearHistory,
	describeVideo,
	GEMINI_MODEL_ID,
	getHistory,
} from "./gemini";
import {
	applyGatePolicy,
	experimental_decide,
	type GateEngineId,
	isGateEngineId,
	RELEVANCE_VALUE,
	resolveGateEngine,
} from "./gate";
import { parseSkyrimState } from "./skyrim-state-parser";
import {
	evaluateReflex,
	REFLEX_COOLDOWN_MS,
} from "./reflex";
import {
	isSttEngineId,
	type SttEngineId,
	resolveSttEngine,
	transcribeSpeech,
	defaultTtsEngine,
	isTtsEngineId,
	resolveTtsEngine,
	synthesizeSpeech,
	type TtsEngineId,
} from "../packages/voice";
import {
	compose,
	type ComposerEngineId,
	defaultComposerEngine,
	isComposerEngineId,
	resolveComposerEngine,
} from "../packages/composer";
import { isSilent } from "./silence";
import { decideUtterance, resolveChannel } from "./speech-arbiter";
import { formatMenuSpeech } from "./menu-speech";
import {
	selectRadarCues,
	RADAR_CADENCE_MS,
} from "../packages/spatial";
import { enqueueActions } from "./action-outbox";
import type { GameStatePayload, MenuFocusState } from "./protocol";
import type { SkyrimConnector } from "./skyrim-connector";
import { SkyrimHybridConnector } from "./skyrim-hybrid-connector";

export type PipelineMode = "fused" | "gated";

interface EngineState {
	isRunning: boolean;
	intervalMs: number;
	systemPrompt: string;
	pipeline: PipelineMode;
	gateEngine: GateEngineId;
	composerEngine: ComposerEngineId;
	ttsEngine: TtsEngineId;
	sttEngine: SttEngineId;
	clients: Set<Peer>;
	abortController: AbortController | null;
	timer: ReturnType<typeof setInterval> | null;
	processing: boolean;
	/**
	 * D2 narration re-cut: the periodic 6s ambient clip tier is OFF by
	 * default — the VLM runs ON DEMAND (a question / "read this" grabs a
	 * fresh clip). `SKYGUIDE_AMBIENT_CLIPS=1` restores the legacy cadence.
	 */
	ambientClipsEnabled: boolean;
	latestGameState: GameStatePayload | null;
	/** Latest mod-context dump riding the POST `context` field (see protocol.ts). */
	latestModContext: Record<string, unknown> | null;
	/** Monotonic token: newest menu utterance wins the audio slot. */
	menuSynthToken: number;
	/** Until this timestamp, high-priority mod context bypasses the ambient cooldown. */
	urgentUntil: number;
	/** Last reflex callout per rule (anti-spam cooldown). */
	reflexLastFired: Map<string, number>;
	/**
	 * Speech-arbiter in-flight flag: set when an audio message is broadcast,
	 * cleared on the client's `audio_done` ack (or after a safety timeout —
	 * a disconnected client must not wedge the arbiter forever).
	 */
	audioInFlight: boolean;
	audioInFlightAt: number;
	pendingQuestion: string | null;
	latestClipBuffer: Buffer | null;
	wakeWordPending: boolean;
	sttProcessing: boolean;
	lastAnswerTime: number;
	connector: SkyrimConnector | null;
}

function resolvePipeline(value: unknown, fallback: PipelineMode): PipelineMode {
	return value === "gated" || value === "fused" ? value : fallback;
}

const state: EngineState = {
	isRunning: false,
	intervalMs: 6000,
	systemPrompt: "",
	pipeline: resolvePipeline(process.env.PIPELINE, "fused"),
	gateEngine: resolveGateEngine(process.env.GATE_ENGINE, "gemini"),
	composerEngine: resolveComposerEngine(process.env.COMPOSER_ENGINE, defaultComposerEngine()),
	ttsEngine: resolveTtsEngine(process.env.TTS_ENGINE, defaultTtsEngine()),
	// STT default = the local runner ("whisper-local" engine id), whose
	// router prefers Parakeet TDT v3 via parakeet-cli for en/es/fr when the
	// model + CLI are installed (Hex's default STT class). ElevenLabs stays
	// in the fallback chain — the seam retries it if local STT fails.
	sttEngine: resolveSttEngine(process.env.STT_ENGINE, "whisper-local"),
	clients: new Set(),
	abortController: null,
	timer: null,
	processing: false,
	ambientClipsEnabled: process.env.SKYGUIDE_AMBIENT_CLIPS === "1",
	latestGameState: null,
	latestModContext: null,
	menuSynthToken: 0,	urgentUntil: 0,
	reflexLastFired: new Map(),
	audioInFlight: false,
	audioInFlightAt: 0,
	pendingQuestion: null,
	latestClipBuffer: null,
	wakeWordPending: false,
	sttProcessing: false,
	lastAnswerTime: 0,
	connector: new SkyrimHybridConnector(() => state.latestModContext),
};

function broadcast(message: Record<string, unknown>) {
	const data = JSON.stringify(message);
	for (const client of state.clients) {
		try {
			client.send(data);
		} catch {
			// client may have disconnected
		}
	}
}

function log(
	level: "info" | "error" | "warn",
	source: string,
	message: string,
) {
	const entry = { type: "log", level, source, message, timestamp: Date.now() };
	broadcast(entry);
	console.log(`[${source}] ${message}`);
}

type PendingClip = {
	videoBuffer: Buffer;
	durationMs: number;
};

// Keep processing strictly sequential, but cap the queue to one "latest" clip.
let clipWorkerRunning = false;
let pendingClip: PendingClip | null = null;

function isCorruptedVideoError(message: string): boolean {
	const normalized = message.toLowerCase();
	return (
		normalized.includes("video is corrupted") ||
		normalized.includes("wrong video metadata") ||
		normalized.includes("0 frames found")
	);
}

export function setConnector(connector: SkyrimConnector) {
	state.connector = connector;
	log("info", "engine", `Skyrim connector set: ${connector.constructor.name}`);
}

/** Mod context as text for the gate (null when unavailable). */
async function modContextText(): Promise<string | null> {
	if (!state.connector) return null;
	try {
		const ctx = await state.connector.getContext();
		return ctx.raw ? parseSkyrimState(ctx.raw) : null;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		log("warn", "gate", `Mod context unavailable: ${msg}`);
		return null;
	}
}

/**
 * Broadcast the observation, suggest actions and synthesize speech.
 * Shared tail of both pipelines.
 */
async function speakToPlayer(input: {
	text: string | null;
	relevance: number;
	actions: { type: string }[];
	latencyMs: number;
	isQuestion: boolean;
	provenance: {
		tier: "gate" | "reflex" | "menu";
		engine: string;
		latencyMs: number;
		relevance: number;
		composer?: string;
		composerEngine?: string;
		composerLatencyMs?: number;
		composerFallbackFrom?: string | null;
	};
	firstRead?: boolean;
}): Promise<void> {
	const isRelevant = input.isQuestion || input.relevance >= 4;

	broadcast({
		type: "description",
		text: input.text,
		relevance: input.relevance,
		actions: input.actions,
		latency: input.latencyMs,
		silent: !isRelevant,
		provenance: input.provenance,
	});

	if (input.actions.length > 0) {
		// Dashboard clients (WS) and the SKSE plugin (HTTP polling) both
		// consume pipeline actions.
		broadcast({ type: "actions", actions: input.actions });
		enqueueActions(input.actions, input.provenance.tier);
		log("info", "engine", `Actions suggested: ${input.actions.map((a) => a.type).join(", ")}`);
	}

	if (!isRelevant || !input.text) {
		log("info", "engine", `Skipping TTS — relevance ${input.relevance}/10`);
		return;
	}
	if (input.provenance.tier !== "menu" && isSilent(input.text)) {
		log("info", "engine", "Silent — skipping TTS");
		return;
	}

	// Speech arbiter (W2): one gate before synthesis. Menu/console state is
	// fast-lane `ui.*` — at most one 500ms tick old, never the stale dump.
	const AUDIO_IN_FLIGHT_TIMEOUT_MS = 120_000;
	const inFlight =
		state.audioInFlight &&
		Date.now() - state.audioInFlightAt < AUDIO_IN_FLIGHT_TIMEOUT_MS;
	const channel = resolveChannel({ tier: input.provenance.tier, isQuestion: input.isQuestion });
	const decision = decideUtterance({
		channel,
		menuOpen: state.latestGameState?.data.ui?.menuOpen ?? false,
		consoleOpen: state.latestGameState?.data.ui?.consoleOpen ?? false,
		isPlaying: inFlight,
		firstRead: input.firstRead,
	});
	if (decision === "drop") {
		log(
			"info",
			"arbiter",
			`Dropped (${channel}) — menu=${state.latestGameState?.data.ui?.menuOpen ?? false} console=${state.latestGameState?.data.ui?.consoleOpen ?? false} inFlight=${inFlight}: "${input.text.slice(0, 50)}"`,
		);
		return;
	}
	if (decision === "stop-and-speak") {
		// Cancel channel: stop whatever the client is playing before the new
		// utterance lands (their Speak() = cancel + say).
		broadcast({ type: "audio_stop" });
		state.audioInFlight = false;
	}

	// Menu utterances are transient (list navigation at ~500ms cadence): a
	// slow synth must never speak an item the player already scrolled past.
	// Capture a token; if a newer menu utterance started while synthesizing,
	// discard the result instead of broadcasting stale audio.
	let menuToken: number | null = null;
	if (channel === "menu") {
		menuToken = ++state.menuSynthToken;
	}

	// Claim the slot BEFORE synthesize so a 100ms menu-focus POST sees
	// isPlaying and firstRead can queue instead of stop-and-speak.
	state.audioInFlight = true;
	state.audioInFlightAt = Date.now();

	const tts = await synthesizeSpeech(input.text, state.ttsEngine);
	if (menuToken !== null && menuToken !== state.menuSynthToken) {
		// Superseded while synthesizing — release and stay silent.
		state.audioInFlight = false;
		log("info", "menu", `Superseded while synthesizing — skipped: "${input.text.slice(0, 50)}"`);
		return;
	}
	if (!tts) {
		state.audioInFlight = false;
		log("error", "tts", `All TTS engines failed — skipping audio for: ${input.text.slice(0, 60)}`);
		flushDeferredMenu();
		return;
	}
	if (input.isQuestion) {
		state.lastAnswerTime = Date.now();
	}
	if (tts.provenance.fallbackFrom) {
		log("warn", "tts", `Engine ${tts.provenance.fallbackFrom} failed — fallback to ${tts.provenance.engine}`);
	}
	log("info", "tts", `${tts.provenance.engine} (${tts.provenance.latencyMs}ms${tts.provenance.cached ? ", cached" : ""})`);
	broadcast({
		type: "audio",
		buffer: tts.audio,
		mimeType: tts.mimeType,
		priority: input.isQuestion ? "answer" : "ambient",
		channel,
		enqueue: decision === "speak",
		text: input.text,
		provenance: {
			tier: "tts",
			engine: tts.provenance.engine,
			latencyMs: tts.provenance.latencyMs,
			cached: tts.provenance.cached,
			fallbackFrom: tts.provenance.fallbackFrom,
		},
	});
}

/** Client ack: the current utterance finished (or was stopped). */
export function notifyAudioDone(): void {
	if (state.audioInFlight) {
		state.audioInFlight = false;
		log("info", "arbiter", "audio_done — channel idle");
	}
	flushDeferredMenu();
}

let deferredMenu: MenuFocusState | null = null;

function speakMenu(menu: MenuFocusState | undefined, firstRead: boolean): void {
	const menuLine = formatMenuSpeech(menu);
	if (!menuLine || !menu?.event) return;
	log("info", "menu", `${menu.event}: ${menuLine}`);
	void speakToPlayer({
		text: menuLine,
		relevance: 8,
		actions: [],
		latencyMs: 0,
		isQuestion: false,
		firstRead,
		provenance: {
			tier: "menu",
			engine: "rules·menu-focus",
			latencyMs: 0,
			relevance: 8,
		},
	});
}

function flushDeferredMenu(): void {
	const menu = deferredMenu;
	if (!menu) return;
	deferredMenu = null;
	speakMenu(menu, true);
}

/** Baseline pipeline: one fused Gemini call decides AND composes. */
async function runFusedPipeline(
	videoBuffer: Buffer,
	question: string | null,
): Promise<void> {
	const startGemini = Date.now();
	const { response, isQuestion } = await describeVideo(
		videoBuffer,
		state.systemPrompt || undefined,
		state.connector || undefined,
		question || undefined,
	);
	const geminiMs = Date.now() - startGemini;

	const observation = response.observation;
	const relevance = response.relevance;
	const finalObservation =
		isQuestion && (!observation || isSilent(observation))
			? "Je ne vois pas assez clairement. Reposez la question en restant immobile une seconde."
			: observation;

	log(
		"info",
		"gemini",
		`Response (${geminiMs}ms): relevance=${relevance}, observation=${observation ?? "(silent)"}, actions=${response.actions?.length ?? 0}`,
	);

	await speakToPlayer({
		text: finalObservation,
		relevance,
		actions: response.actions,
		latencyMs: geminiMs,
		isQuestion,
		provenance: {
			tier: "gate",
			engine: GEMINI_MODEL_ID,
			latencyMs: geminiMs,
			relevance,
		},
	});
}

/** Gated pipeline: System 1 gate decides; composer runs only on speak. */
async function runGatedPipeline(videoBuffer: Buffer): Promise<void> {
	const modContext = await modContextText();
	const gateStart = Date.now();
	const { decision, provenance: gateProv } = await experimental_decide(
		videoBuffer,
		"video/webm",
		state.gateEngine,
		{ history: getHistory(), modContext },
	);
	const gateMs = Date.now() - gateStart;
	const policy = applyGatePolicy(decision);

	log(
		"info",
		"gate",
		`${state.gateEngine}/${gateProv.modelId} (${gateMs}ms): speak=${policy.speak} (${policy.reason}), relevance=${decision.relevance}, confidence=${decision.confidence.toFixed(2)}`,
	);

	if (!policy.speak) {
		// The gate IS the output: SILENCE, with provenance.
		await speakToPlayer({
			text: null,
			relevance: RELEVANCE_VALUE[decision.relevance],
			actions: [],
			latencyMs: gateMs,
			isQuestion: false,
			provenance: {
				tier: "gate",
				engine: `${state.gateEngine}·${gateProv.modelId}`,
				latencyMs: gateMs,
				relevance: RELEVANCE_VALUE[decision.relevance],
			},
		});
		return;
	}

	// Escalation: compose through the composer seam (Stage 6). The gate's
	// summary rides along as the intention so the composition aligns with
	// the decision it paid for. Falls down the composer chain on failure
	// (e.g. local VLM down → cloud composer).
	const composerStart = Date.now();
	const composer = await compose(
		{
			clip: { buffer: videoBuffer, mediaType: "video/webm" },
			history: getHistory(),
			modContext,
			systemPrompt: state.systemPrompt || undefined,
			intention: { summary: decision.summary },
		},
		state.composerEngine,
	);
	const composerMs = Date.now() - composerStart;

	if (!composer) {
		// Every composer engine failed — record the tombstone and stay
		// silent rather than looping gate-speak → failed-compose.
		if (decision.summary) {
			addToHistory(decision.summary, RELEVANCE_VALUE[decision.relevance]);
		}
		log(
			"error",
			"composer",
			`All composer engines failed — tombstone recorded: "${decision.summary}"`,
		);
		await speakToPlayer({
			text: null,
			relevance: RELEVANCE_VALUE[decision.relevance],
			actions: [],
			latencyMs: gateMs + composerMs,
			isQuestion: false,
			provenance: {
				tier: "gate",
				engine: `${state.gateEngine}·${gateProv.modelId}`,
				latencyMs: gateMs,
				relevance: RELEVANCE_VALUE[decision.relevance],
				composerEngine: state.composerEngine,
				composerLatencyMs: composerMs,
			},
		});
		return;
	}

	const observation = composer.observation;
	// An honest "cannot see" is a veto regardless of the relevance the
	// composer reports — otherwise a canned apology with high relevance is
	// spoken on every re-trigger of the same clip and the tombstone never
	// records (repeat loop).
	const unreadable = composer.unreadable === true;
	const composed =
		!unreadable &&
		observation !== null &&
		!isSilent(observation) &&
		composer.relevance >= 4;
	if (!composed && decision.summary) {
		// Composer vetoed the gate. Nothing entered the real history, so the
		// next identical clip would re-trigger gate-speak → composer call,
		// forever. Record the gate's summary as a tombstone so the novelty
		// filter suppresses the repeat (the scene hasn't changed either).
		addToHistory(decision.summary, RELEVANCE_VALUE[decision.relevance]);
		log(
			"info",
			"gate",
			`Composer vetoed the gate${unreadable ? " (clip unreadable)" : ""} — tombstone recorded: "${decision.summary}"`,
		);
	}
	if (composer.provenance.fallbackFrom) {
		log(
			"warn",
			"composer",
			`Engine ${composer.provenance.fallbackFrom} failed — fallback to ${composer.provenance.engine}`,
		);
	}
	log(
		"info",
		"composer",
		`${composer.provenance.engine}/${composer.provenance.modelId} (${composer.provenance.latencyMs}ms): relevance=${composer.relevance}${unreadable ? ", unreadable" : ""}, observation=${observation ?? "(silent)"}`,
	);

	await speakToPlayer({
		// An unreadable clip vetoes speech entirely: the tombstone above
		// breaks the repeat loop, and nothing reaches the player.
		text: unreadable ? null : observation,
		relevance: unreadable ? RELEVANCE_VALUE.minor : composer.relevance,
		actions: unreadable ? [] : composer.actions,
		latencyMs: gateMs + composerMs,
		isQuestion: false,
		provenance: {
			tier: "gate",
			engine: `${state.gateEngine}·${gateProv.modelId}`,
			latencyMs: gateMs,
			// Effective outcome (what actually reached the player), not the
			// gate's intention.
			relevance: unreadable ? RELEVANCE_VALUE.minor : composer.relevance,
			composer: composer.provenance.modelId,
			composerEngine: composer.provenance.engine,
			composerLatencyMs: composer.provenance.latencyMs,
			composerFallbackFrom: composer.provenance.fallbackFrom,
		},
	});
}

export function processClip(videoBuffer: Buffer, durationMs: number) {
	// D2 gate: with the ambient tier off, periodic clips are dropped unless a
	// question is pending (Tier-2 on-demand — the voice flow sets
	// `pendingQuestion` BEFORE the client's fresh clip arrives, so answers
	// still work). `latestClipBuffer` is kept regardless — cheap and useful.
	state.latestClipBuffer = videoBuffer;
	if (!state.ambientClipsEnabled && !state.pendingQuestion) {
		log("info", "engine", "Ambient clips off (D2) — clip kept for on-demand only");
		return;
	}
	if (clipWorkerRunning) {
		// Overwrite any older queued clip: we only care about the freshest frame.
		pendingClip = { videoBuffer, durationMs };
		return;
	}

	clipWorkerRunning = true;

	void (async () => {
		let current: PendingClip | null = { videoBuffer, durationMs };
		while (current) {
			state.processing = true;
			try {
				// Grab and clear pending question atomically
				const question = state.pendingQuestion;
				state.pendingQuestion = null;

				// High-priority mod context (critical game events) temporarily
				// bypasses the ambient cooldown so emergencies get through.
				const urgent = Date.now() < state.urgentUntil;

				// Skip ambient clips that arrive too soon after an answer
				// to avoid redundant descriptions
				if (
					!question &&
					!urgent &&
					Date.now() - state.lastAnswerTime < state.intervalMs
				) {
					log("info", "engine", "Skipping ambient clip — answer cooldown active");
				} else {
					log(
						"info",
						"engine",
						`Processing clip (${(current.videoBuffer.length / 1024).toFixed(0)}KB, ${current.durationMs}ms)${question ? ` [question: ${question}]` : ""}${urgent ? " [urgent]" : ""} [${state.pipeline}]`,
					);

					if (state.pipeline === "gated" && !question) {
						// Gated pipeline: System 1 decides speak/silence first; the
						// composer only runs when the gate says speak.
						await runGatedPipeline(current.videoBuffer);
					} else {
						// Fused pipeline (baseline): one Gemini call decides AND composes.
						// Questions always take this path — they need an answer.
						await runFusedPipeline(current.videoBuffer, question);
					}
				}
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				if (isCorruptedVideoError(msg)) {
					log("warn", "engine", `Ignoring invalid clip: ${msg}`);
				} else {
					log("error", "engine", `Processing error: ${msg}`);
				}
			} finally {
				state.processing = false;
			}

			current = pendingClip;
			pendingClip = null;
		}

		clipWorkerRunning = false;
		if (pendingClip) {
			const next = pendingClip;
			pendingClip = null;
			processClip(next.videoBuffer, next.durationMs);
		}
	})();
}

function statusPayload() {
	return {
		isRunning: state.isRunning,
		intervalMs: state.intervalMs,
		ambientClipsEnabled: state.ambientClipsEnabled,
		pipeline: state.pipeline,
		gateEngine: state.gateEngine,
		composerEngine: state.composerEngine,
		ttsEngine: state.ttsEngine,
		sttEngine: state.sttEngine,
		profile: activeProfile(),
	};
}

/**
 * One-shot engine presets (Stage 6): the literal seam values per profile.
 * Single source of truth — applyProfile() writes them, activeProfile()
 * detects them, so the badge and the buttons can never drift apart.
 */
const PROFILE_PRESETS: ReadonlyArray<{
	name: "offline" | "cloud";
	pipeline: PipelineMode;
	gateEngine: GateEngineId;
	composerEngine: ComposerEngineId;
	ttsEngine: TtsEngineId;
	sttEngine: SttEngineId;
}> = [
	{
		name: "offline",
		pipeline: "gated",
		gateEngine: "local",
		composerEngine: "local",
		ttsEngine: "piper-local",
		sttEngine: "whisper-local",
	},
	{
		name: "cloud",
		pipeline: "fused",
		gateEngine: "gemini",
		composerEngine: "gemini-cloud",
		ttsEngine: "elevenlabs",
		sttEngine: "elevenlabs",
	},
];

/**
 * Derived profile label for the dashboard: the preset every seam currently
 * matches, "custom" otherwise.
 */
function activeProfile(): "offline" | "cloud" | "custom" {
	const preset = PROFILE_PRESETS.find(
		(p) =>
			state.pipeline === p.pipeline &&
			state.gateEngine === p.gateEngine &&
			state.composerEngine === p.composerEngine &&
			state.ttsEngine === p.ttsEngine &&
			state.sttEngine === p.sttEngine,
	);
	return preset?.name ?? "custom";
}

/**
 * One-shot profiles (Stage 6): flip every seam at once. Engines that are
 * unavailable right now are still set — the dashboard shows their setup
 * hints, and availability can change without re-applying the profile.
 */
export function applyProfile(profile: unknown): void {
	const preset = PROFILE_PRESETS.find((p) => p.name === profile);
	if (!preset) {
		log("warn", "engine", `Unknown profile: ${String(profile)}`);
		return;
	}
	updateConfig({
		pipeline: preset.pipeline,
		gateEngine: preset.gateEngine,
		composerEngine: preset.composerEngine,
		ttsEngine: preset.ttsEngine,
		sttEngine: preset.sttEngine,
	});
	log(
		"info",
		"engine",
		`${preset.name[0].toUpperCase()}${preset.name.slice(1)} profile applied (pipeline + gate/composer/tts/stt)`,
	);
}

export function start() {
	if (state.isRunning) return;
	state.isRunning = true;
	log(
		"info",
		"engine",
		`Engine started (clips: ${state.ambientClipsEnabled ? `${state.intervalMs}ms ambient` : "on-demand only (D2)"} , tts=${state.ttsEngine}, stt=${state.sttEngine})`,
	);
	broadcast({ type: "status", ...statusPayload() });
}

export function stop() {
	if (!state.isRunning) return;
	state.isRunning = false;

	clearHistory();
	log("info", "engine", "Engine stopped");
	broadcast({ type: "status", ...statusPayload() });
}

export function updateConfig(config: {
	intervalMs?: number;
	systemPrompt?: string;
	pipeline?: unknown;
	gateEngine?: unknown;
	composerEngine?: unknown;
	ttsEngine?: unknown;
	sttEngine?: unknown;
}) {
	if (
		config.intervalMs !== undefined &&
		config.intervalMs !== state.intervalMs
	) {
		state.intervalMs = Math.max(1000, Math.min(10000, config.intervalMs));
		log("info", "engine", `Interval updated to ${state.intervalMs}ms`);
	}

	if (config.systemPrompt !== undefined) {
		state.systemPrompt = config.systemPrompt;
		log("info", "engine", "System prompt updated");
	}

	if (config.pipeline !== undefined) {
		const next = resolvePipeline(config.pipeline, state.pipeline);
		if (next !== state.pipeline) {
			state.pipeline = next;
			log("info", "engine", `Pipeline set to ${next}`);
		}
	}

	if (config.gateEngine !== undefined) {
		const next = resolveGateEngine(config.gateEngine, state.gateEngine);
		if (next !== state.gateEngine) {
			state.gateEngine = next;
			log("info", "engine", `Gate engine set to ${next}`);
		} else if (!isGateEngineId(config.gateEngine)) {
			log("warn", "engine", `Unknown gate engine "${String(config.gateEngine)}" — kept ${state.gateEngine}`);
		}
	}

	if (config.composerEngine !== undefined) {
		const next = resolveComposerEngine(config.composerEngine, state.composerEngine);
		if (next !== state.composerEngine) {
			state.composerEngine = next;
			log("info", "engine", `Composer engine set to ${next}`);
		} else if (!isComposerEngineId(config.composerEngine)) {
			log("warn", "engine", `Unknown composer engine "${String(config.composerEngine)}" — kept ${state.composerEngine}`);
		}
	}

	if (config.ttsEngine !== undefined) {
		const next = resolveTtsEngine(config.ttsEngine, state.ttsEngine);
		if (next !== state.ttsEngine) {
			state.ttsEngine = next;
			log("info", "engine", `TTS engine set to ${next}`);
		} else if (!isTtsEngineId(config.ttsEngine)) {
			log("warn", "engine", `Unknown TTS engine "${String(config.ttsEngine)}" — kept ${state.ttsEngine}`);
		}
	}

	if (config.sttEngine !== undefined) {
		const next = resolveSttEngine(config.sttEngine, state.sttEngine);
		if (next !== state.sttEngine) {
			state.sttEngine = next;
			log("info", "engine", `STT engine set to ${next}`);
		} else if (!isSttEngineId(config.sttEngine)) {
			log("warn", "engine", `Unknown STT engine "${String(config.sttEngine)}" — kept ${state.sttEngine}`);
		}
	}

	broadcast({ type: "status", ...statusPayload() });
}

export function registerClient(peer: Peer) {
	state.clients.add(peer);
	log("info", "engine", `Client connected (${state.clients.size} total)`);

	peer.send(JSON.stringify({ type: "status", ...statusPayload() }));

	if (state.latestGameState) {
		peer.send(
			JSON.stringify({
				type: "gameState",
				data: state.latestGameState.data,
				priority: state.latestGameState.priority,
				timestamp: state.latestGameState.timestamp,
			}),
		);
	}
}

export function unregisterClient(peer: Peer) {
	state.clients.delete(peer);
	log("info", "engine", `Client disconnected (${state.clients.size} total)`);
}

export function getState() {
	return {
		isRunning: state.isRunning,
		intervalMs: state.intervalMs,
		clients: state.clients.size,
	};
}

export function getConfig() {
	return {
		intervalMs: state.intervalMs,
		ambientClipsEnabled: state.ambientClipsEnabled,
		systemPrompt: state.systemPrompt,
		pipeline: state.pipeline,
		gateEngine: state.gateEngine,
		composerEngine: state.composerEngine,
		ttsEngine: state.ttsEngine,
		sttEngine: state.sttEngine,
		profile: activeProfile(),
	};
}

export function processQuestion(text: string) {
	state.pendingQuestion = text;
	log("info", "engine", `Question received: ${text}`);

	// Drop queued ambient clip and let the newest clip take priority.
	pendingClip = null;

	// If we have a recent clip, trigger immediate processing
	if (state.latestClipBuffer) {
		const clip = state.latestClipBuffer;
		processClip(clip, 0);
	}
}

const WAKE_WORD = "guide";
const VOICE_DEBUG_LOGS = process.env.VOICE_DEBUG === "1";
const MIN_FREEFORM_QUESTION_CHARS = 6;
const MIN_FREEFORM_QUESTION_WORDS = 2;
const QUESTION_PREFIXES = [
	"ou",
	"où",
	"que",
	"qu",
	"quoi",
	"qui",
	"quand",
	"comment",
	"pourquoi",
	"combien",
	"quel",
	"quelle",
	"quels",
	"quelles",
	"est-ce",
	"est ce",
	"peux-tu",
	"peux tu",
	"pouvez-vous",
	"pouvez vous",
	"dois-je",
	"dois je",
	"faut-il",
	"faut il",
	"indique",
	"dis-moi",
	"dis moi",
] as const;

function normalizeForQuestionIntent(text: string): string {
	return text
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "");
}

function looksLikeFreeformQuestion(text: string): boolean {
	const trimmed = text.trim();
	if (trimmed.length < MIN_FREEFORM_QUESTION_CHARS) return false;

	const normalized = normalizeForQuestionIntent(trimmed);
	const words = normalized.split(/\s+/).filter(Boolean);
	if (words.length < MIN_FREEFORM_QUESTION_WORDS) return false;

	if (trimmed.includes("?")) return true;
	return QUESTION_PREFIXES.some(
		(prefix) => normalized === prefix || normalized.startsWith(`${prefix} `),
	);
}

function extractQuestionAfterWakeWord(text: string): string | null {
	const wakePattern = new RegExp(`\\b${WAKE_WORD}\\b[\\s,.;:!?-]*`, "i");
	const match = wakePattern.exec(text);
	if (!match) return null;

	const afterWake = text.slice(match.index + match[0].length).trim();
	return afterWake.length > 0 ? afterWake : "";
}

function maybeExtractQuestion(text: string): {
	question: string | null;
	waitingForNextChunk: boolean;
	reason: "wake" | "freeform" | "none";
} {
	const afterWake = extractQuestionAfterWakeWord(text);
	if (afterWake !== null) {
		if (afterWake === "") {
			return { question: null, waitingForNextChunk: true, reason: "wake" };
		}
		return { question: afterWake, waitingForNextChunk: false, reason: "wake" };
	}

	if (looksLikeFreeformQuestion(text)) {
		return { question: text.trim(), waitingForNextChunk: false, reason: "freeform" };
	}

	return { question: null, waitingForNextChunk: false, reason: "none" };
}

export async function processAudioChunk(audioBuffer: Buffer, mimeType: string) {
	// Process STT sequentially — skip if already processing
	if (state.sttProcessing) return;
	state.sttProcessing = true;

	try {
		const { text, provenance } = await transcribeSpeech(
			audioBuffer,
			mimeType,
			state.sttEngine,
		);
		const trimmed = text.trim();
		if (!trimmed || trimmed.length < 3) {
			return;
		}

		log(
			"info",
			"stt",
			`${provenance.engine} (${provenance.latencyMs}ms${provenance.fallbackFrom ? `, fallback from ${provenance.fallbackFrom}` : ""}): "${trimmed.slice(0, 80)}"`,
		);

		if (state.wakeWordPending) {
			// Previous chunk had just "Guide" — this chunk is the question
			state.wakeWordPending = false;
			broadcast({ type: "voice_status", status: "listening" });
			log("info", "voice", `Question (after wake): ${trimmed}`);
			broadcast({
				type: "voice_question",
				text: trimmed,
				stt: provenance,
			});
			processQuestion(trimmed);
			return;
		}

		const extracted = maybeExtractQuestion(trimmed);

		if (extracted.waitingForNextChunk) {
			state.wakeWordPending = true;
			broadcast({ type: "voice_status", status: "wake-detected" });
			log("info", "voice", "Wake word detected, waiting for question...");
			return;
		}

		if (!extracted.question) {
			if (VOICE_DEBUG_LOGS) {
				log("info", "voice", `Ignored transcript: ${trimmed.slice(0, 120)}`);
			}
			return;
		}

		const voiceSourceLabel =
			extracted.reason === "freeform" ? "Question (freeform):" : "Question:";
		log("info", "voice", `${voiceSourceLabel} ${extracted.question}`);
		broadcast({
			type: "voice_question",
			text: extracted.question,
			stt: provenance,
		});
		processQuestion(extracted.question);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		log("error", "voice", `STT error: ${msg}`);
	} finally {
		state.sttProcessing = false;
	}
}

export function updateGameState(payload: GameStatePayload): boolean {
	state.latestGameState = payload;
	if (payload.context && Object.keys(payload.context).length > 0) {
		state.latestModContext = payload.context;
	}

	broadcast({
		type: "gameState",
		data: payload.data,
		priority: payload.priority,
		timestamp: payload.timestamp,
	});

	// The dashboard still mirrors mod context when the engine is stopped, but
	// a stopped engine must never speak (reflex TTS), sweep the radar, or set
	// urgency flags.
	if (!state.isRunning) return false;

	// Radar sweeps ride the game's own 500ms POST cadence, throttled to the
	// ported 2500ms (W5). Fire-and-forget: a slow dump read never delays the
	// reflex path.
	maybeSweepRadar();

	// Reflex rules (Stage 5): canned 0ms callouts for true emergencies,
	// bypassing the Gate and the composer entirely. Cooldown per rule.
	const reflex = evaluateReflex(payload.data);
	let spokeReflex = false;
	if (reflex) {
		const last = state.reflexLastFired.get(reflex.rule) ?? 0;
		if (Date.now() - last >= REFLEX_COOLDOWN_MS) {
			state.reflexLastFired.set(reflex.rule, Date.now());
			log("info", "reflex", `${reflex.rule}: ${reflex.text}`);
			void speakToPlayer({
				text: reflex.text,
				relevance: 8,
				actions: [],
				latencyMs: 0,
				isQuestion: false,
				provenance: {
					tier: "reflex",
					engine: `rules·${reflex.rule}`,
					latencyMs: 0,
					relevance: 8,
				},
			});
			spokeReflex = true;
		}
	}

	// Menu focus is a 0ms canned line (no Gate). Danger this tick wins the
	// speaker but must not erase the event — defer until audio_done.
	if (payload.data.menu?.event) {
		if (spokeReflex) {
			deferredMenu = payload.data.menu;
		} else {
			deferredMenu = null;
			speakMenu(payload.data.menu, payload.data.menu.firstRead === true);
		}
	}

	// High/critical game events temporarily bypass the ambient clip cooldown:
	// the next clip that arrives gets processed immediately instead of being
	// dropped (screenshots are browser-side now, so the server cannot trigger
	// a description on its own — see ADR-0002 lift notes).
	if (payload.priority === "critical" || payload.priority === "high") {
		state.urgentUntil = Date.now() + state.intervalMs + 2000;
		log(
			"info",
			"engine",
			`Urgent game state (${payload.priority}) — cooldown bypassed for the next clip`,
		);
		return true;
	}

	return false;
}

/**
 * Ambient radar (W5): reads the context-lane dump at the ported 2500ms
 * cadence and broadcasts `{"type":"spatial", cues:[…]}`. Driven by game
 * POSTs (no standalone timer) so the radar dies with the game. Skyrim
 * Access suppression lives inside the selection.
 */
let lastRadarSweepAt = 0;

async function sweepRadar(): Promise<void> {
	if (!state.connector) return;
	try {
		const context = await state.connector.getContext();
		if (!context.raw) return;
		const heading = state.latestGameState?.data.headingAngleZ ?? null;
		const cues = selectRadarCues({ raw: context.raw, playerHeadingDeg: heading });
		if (cues.length > 0) {
			broadcast({ type: "spatial", cues });
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		log("warn", "radar", `Sweep failed: ${msg}`);
	}
}

function maybeSweepRadar(): void {
	const now = Date.now();
	if (now - lastRadarSweepAt < RADAR_CADENCE_MS) return;
	// The radar is a walking aid: cue pings while a menu is open are noise
	// that pokes between the menu narration lines (the player is reading a
	// list, not crossing a field). Menu-open state is fast-lane ui.*.
	const menuOpen = state.latestGameState?.data.ui?.menuOpen ?? false;
	if (menuOpen) return;
	lastRadarSweepAt = now;
	void sweepRadar();
}
