import type { Peer } from "crossws";
import { transcribeAudio } from "./elevenlabs-stt";
import { clearHistory, describeVideo } from "./gemini";
import { textToSpeech } from "./mistral-tts";
import type { GameStateData, GameStatePayload } from "./protocol";

interface EngineState {
	isRunning: boolean;
	intervalMs: number;
	systemPrompt: string;
	clients: Set<Peer>;
	abortController: AbortController | null;
	timer: ReturnType<typeof setInterval> | null;
	processing: boolean;
	latestGameState: GameStatePayload | null;
	lastGeminiCall: number;
	geminiProcessing: boolean;
	pendingQuestion: string | null;
	latestClipBuffer: Buffer | null;
	wakeWordPending: boolean;
	sttProcessing: boolean;
	lastAnswerTime: number;
}

const state: EngineState = {
	isRunning: false,
	intervalMs: 7000,
	systemPrompt: "",
	clients: new Set(),
	abortController: null,
	timer: null,
	processing: false,
	latestGameState: null,
	lastGeminiCall: 0,
	geminiProcessing: false,
	pendingQuestion: null,
	latestClipBuffer: null,
	wakeWordPending: false,
	sttProcessing: false,
	lastAnswerTime: 0,
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

// Sequential processing of clips via promise chain
let processingChain = Promise.resolve();

const SILENCE_MARKERS = [
	"...",
	"rien à signaler",
	"rien à signaler.",
	"zone calme",
	"zone calme.",
];

function isSilent(text: string): boolean {
	const trimmed = text.trim().toLowerCase();
	if (trimmed === "" || trimmed.replace(/\./g, "").trim() === "") return true;
	if (SILENCE_MARKERS.includes(trimmed)) return true;
	if (trimmed.replace(/[.\s]/g, "").length < 3) return true;
	return false;
}

export function processClip(videoBuffer: Buffer, durationMs: number) {
	// Keep latest clip for on-demand question processing
	state.latestClipBuffer = videoBuffer;

	processingChain = processingChain.then(async () => {
		try {
			// Grab and clear pending question atomically
			const question = state.pendingQuestion;
			state.pendingQuestion = null;

			// Skip ambient clips that arrive too soon after an answer
			// to avoid redundant descriptions
			if (!question && Date.now() - state.lastAnswerTime < state.intervalMs) {
				log("info", "engine", "Skipping ambient clip — answer cooldown active");
				return;
			}

			log(
				"info",
				"engine",
				`Processing clip (${(videoBuffer.length / 1024).toFixed(0)}KB, ${durationMs}ms)${question ? ` [question: ${question}]` : ""}`,
			);

			const startGemini = Date.now();
			const { text: description, isQuestion } = await describeVideo(
				videoBuffer,
				state.systemPrompt || undefined,
				undefined,
				question || undefined,
			);
			const geminiMs = Date.now() - startGemini;
			log("info", "gemini", `Description (${geminiMs}ms): ${description}`);

			broadcast({
				type: "description",
				text: description,
				latency: geminiMs,
				silent: !isQuestion && isSilent(description),
			});

			// Skip TTS for silence markers (unless answering a question)
			if (!isQuestion && isSilent(description)) {
				log("info", "engine", "Silent — skipping TTS");
				return;
			}

			const ttsBuffer = await textToSpeech(description);
			if (isQuestion) {
				state.lastAnswerTime = Date.now();
			}
			broadcast({
				type: "audio",
				buffer: ttsBuffer.toString(),
				priority: isQuestion ? "answer" : "ambient",
				text: description,
			});
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			log("error", "engine", `Processing error: ${msg}`);
		}
	});
}

async function triggerGeminiWithGameState(gameState: GameStateData) {
	try {
		const frame = await captureScreen();
		broadcast({
			type: "frame",
			base64: frame.base64,
			timestamp: frame.timestamp,
		});

		const startGemini = Date.now();
		const description = await describeFrame(
			frame.base64,
			state.systemPrompt || undefined,
			gameState,
		);
		const geminiMs = Date.now() - startGemini;
		log(
			"info",
			"gemini",
			`Description (game-state triggered, ${geminiMs}ms): ${description}`,
		);
		broadcast({ type: "description", text: description, latency: geminiMs });

		const audioBase64 = await textToSpeech(description);
		broadcast({ type: "audio", data: audioBase64, description, latency: 0 });
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		log("error", "engine", `Game-state Gemini error: ${msg}`);
	} finally {
		state.geminiProcessing = false;
	}
}

export function start() {
	if (state.isRunning) return;
	state.isRunning = true;
	log(
		"info",
		"engine",
		`Engine started (expecting ${state.intervalMs}ms clips)`,
	);
	broadcast({ type: "status", isRunning: true, intervalMs: state.intervalMs });
}

export function stop() {
	if (!state.isRunning) return;
	state.isRunning = false;

	clearHistory();
	log("info", "engine", "Engine stopped");
	broadcast({ type: "status", isRunning: false, intervalMs: state.intervalMs });
}

export function updateConfig(config: {
	intervalMs?: number;
	systemPrompt?: string;
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

	broadcast({
		type: "status",
		isRunning: state.isRunning,
		intervalMs: state.intervalMs,
	});
}

export function registerClient(peer: Peer) {
	state.clients.add(peer);
	log("info", "engine", `Client connected (${state.clients.size} total)`);

	peer.send(
		JSON.stringify({
			type: "status",
			isRunning: state.isRunning,
			intervalMs: state.intervalMs,
		}),
	);

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

export function processQuestion(text: string) {
	state.pendingQuestion = text;
	log("info", "engine", `Question received: ${text}`);

	// If we have a recent clip, trigger immediate processing
	if (state.latestClipBuffer) {
		const clip = state.latestClipBuffer;
		processClip(clip, 0);
	}
}

const WAKE_WORD = "guide";

export async function processAudioChunk(audioBuffer: Buffer, mimeType: string) {
	// Process STT sequentially — skip if already processing
	if (state.sttProcessing) return;
	state.sttProcessing = true;

	try {
		const transcript = await transcribeAudio(audioBuffer, mimeType);
		const trimmed = transcript.trim();
		if (!trimmed || trimmed.length < 3) {
			return;
		}

		const lower = trimmed.toLowerCase();

		if (state.wakeWordPending) {
			// Previous chunk had just "Guide" — this chunk is the question
			state.wakeWordPending = false;
			broadcast({ type: "voice_status", status: "listening" });
			log("info", "voice", `Question (after wake): ${trimmed}`);
			broadcast({ type: "voice_question", text: trimmed });
			processQuestion(trimmed);
			return;
		}

		// const wakeIndex = lower.indexOf(WAKE_WORD);
		// if (wakeIndex === -1) return;

		// Found wake word — extract question after it
		// const afterWake = trimmed
		// 	.slice(wakeIndex + WAKE_WORD.length)
		// 	.replace(/^[,.\s]+/, "")
		// 	.trim();

		const afterWake = trimmed;

		if (afterWake.length > 0) {
			// "Guide, qu'est-ce qu'il y a devant moi?" — question in same chunk
			log("info", "voice", `Question: ${afterWake}`);
			broadcast({ type: "voice_question", text: afterWake });
			processQuestion(afterWake);
		} else {
			// Just "Guide" alone — wait for next chunk
			state.wakeWordPending = true;
			broadcast({ type: "voice_status", status: "wake-detected" });
			log("info", "voice", "Wake word detected, waiting for question...");
		}
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

	const now = Date.now();
	const timeSinceLastCall = now - state.lastGeminiCall;
	const MIN_CALL_INTERVAL = 5000;

	if (timeSinceLastCall < MIN_CALL_INTERVAL) return false;

	const shouldTrigger =
		payload.priority === "critical" ||
		payload.priority === "high" ||
		timeSinceLastCall > 30000;

	if (shouldTrigger && !state.geminiProcessing && !state.processing) {
		state.lastGeminiCall = now;
		state.geminiProcessing = true;
		triggerGeminiWithGameState(payload.data).catch(() => {
			state.geminiProcessing = false;
		});
		return true;
	}

	return false;
}
