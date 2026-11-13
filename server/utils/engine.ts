import type { Peer } from "crossws";
import { clearHistory, describeVideo, GEMINI_MODEL_ID } from "./gemini";
import {
	isSttEngineId,
	type SttEngineId,
	resolveSttEngine,
	transcribeSpeech,
} from "./stt";
import { isSilent } from "./silence";
import {
	isTtsEngineId,
	type TtsEngineId,
	resolveTtsEngine,
	synthesizeSpeech,
} from "./tts";
import type { GameStatePayload } from "./protocol";
import type { SkyrimConnector } from "./skyrim-connector";
import { SkyrimFileConnector } from "./skyrim-file-connector";

interface EngineState {
	isRunning: boolean;
	intervalMs: number;
	systemPrompt: string;
	ttsEngine: TtsEngineId;
	sttEngine: SttEngineId;
	clients: Set<Peer>;
	abortController: AbortController | null;
	timer: ReturnType<typeof setInterval> | null;
	processing: boolean;
	latestGameState: GameStatePayload | null;
	/** Until this timestamp, high-priority mod context bypasses the ambient cooldown. */
	urgentUntil: number;
	pendingQuestion: string | null;
	latestClipBuffer: Buffer | null;
	wakeWordPending: boolean;
	sttProcessing: boolean;
	lastAnswerTime: number;
	connector: SkyrimConnector | null;
}

const state: EngineState = {
	isRunning: false,
	intervalMs: 6000,
	systemPrompt: "",
	ttsEngine: resolveTtsEngine(process.env.TTS_ENGINE, "elevenlabs"),
	sttEngine: resolveSttEngine(process.env.STT_ENGINE, "elevenlabs"),
	clients: new Set(),
	abortController: null,
	timer: null,
	processing: false,
	latestGameState: null,
	urgentUntil: 0,
	pendingQuestion: null,
	latestClipBuffer: null,
	wakeWordPending: false,
	sttProcessing: false,
	lastAnswerTime: 0,
	connector: new SkyrimFileConnector(),
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

export function processClip(videoBuffer: Buffer, durationMs: number) {
	// Keep latest clip for on-demand question processing
	state.latestClipBuffer = videoBuffer;
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
						`Processing clip (${(current.videoBuffer.length / 1024).toFixed(0)}KB, ${current.durationMs}ms)${question ? ` [question: ${question}]` : ""}${urgent ? " [urgent]" : ""}`,
					);

					const startGemini = Date.now();
					const { response, isQuestion } = await describeVideo(
						current.videoBuffer,
						state.systemPrompt || undefined,
						state.connector || undefined,
						question || undefined,
					);
					const geminiMs = Date.now() - startGemini;

					const observation = response.observation;
					const relevance = response.relevance;
					const actions = response.actions;
					const finalObservation =
						isQuestion && (!observation || isSilent(observation))
							? "Je ne vois pas assez clairement. Reposez la question en restant immobile une seconde."
							: observation;

					log(
						"info",
						"gemini",
						`Response (${geminiMs}ms): relevance=${relevance}, observation=${observation ?? "(silent)"}, actions=${actions?.length ?? 0}`,
					);

					const isRelevant = isQuestion || relevance >= 4;

					// Provenance chip (Stage 4): which gate decided, how fast,
					// and how relevant it judged the moment.
					broadcast({
						type: "description",
						text: finalObservation,
						relevance,
						actions,
						latency: geminiMs,
						silent: !isRelevant,
						provenance: {
							tier: "gate",
							engine: GEMINI_MODEL_ID,
							latencyMs: geminiMs,
							relevance,
						},
					});

					// Broadcast actions for future use
					if (actions && actions.length > 0) {
						broadcast({ type: "actions", actions });
						log(
							"info",
							"engine",
							`Actions suggested: ${actions.map((a) => a.type).join(", ")}`,
						);
					}

					// Skip TTS for low-relevance observations (unless answering a question)
					if (!isRelevant || !finalObservation) {
						log("info", "engine", `Skipping TTS — relevance ${relevance}/10`);
					} else if (isSilent(finalObservation)) {
						log("info", "engine", "Silent — skipping TTS");
					} else {
						const tts = await synthesizeSpeech(finalObservation, state.ttsEngine);
						if (!tts) {
							log(
								"error",
								"tts",
								`All TTS engines failed — skipping audio for: ${finalObservation.slice(0, 60)}`,
							);
						} else {
							if (isQuestion) {
								state.lastAnswerTime = Date.now();
							}
							if (tts.provenance.fallbackFrom) {
								log(
									"warn",
									"tts",
									`Engine ${tts.provenance.fallbackFrom} failed — fallback to ${tts.provenance.engine}`,
								);
							}
							log(
								"info",
								"tts",
								`${tts.provenance.engine} (${tts.provenance.latencyMs}ms${tts.provenance.cached ? ", cached" : ""})`,
							);
							broadcast({
								type: "audio",
								buffer: tts.audio,
								mimeType: tts.mimeType,
								priority: isQuestion ? "answer" : "ambient",
								text: finalObservation,
								provenance: {
									tier: "tts",
									engine: tts.provenance.engine,
									latencyMs: tts.provenance.latencyMs,
									cached: tts.provenance.cached,
									fallbackFrom: tts.provenance.fallbackFrom,
								},
							});
						}
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
		ttsEngine: state.ttsEngine,
		sttEngine: state.sttEngine,
	};
}

export function start() {
	if (state.isRunning) return;
	state.isRunning = true;
	log(
		"info",
		"engine",
		`Engine started (expecting ${state.intervalMs}ms clips, tts=${state.ttsEngine}, stt=${state.sttEngine})`,
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
		systemPrompt: state.systemPrompt,
		ttsEngine: state.ttsEngine,
		sttEngine: state.sttEngine,
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

	broadcast({
		type: "gameState",
		data: payload.data,
		priority: payload.priority,
		timestamp: payload.timestamp,
	});

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
