import type { Peer } from "crossws";
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
}

const state: EngineState = {
	isRunning: false,
	intervalMs: 3000,
	systemPrompt: "",
	clients: new Set(),
	abortController: null,
	timer: null,
	processing: false,
	latestGameState: null,
	lastGeminiCall: 0,
	geminiProcessing: false,
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

export function processClip(videoBuffer: Buffer, durationMs: number) {
	processingChain = processingChain.then(async () => {
		try {
			log(
				"info",
				"engine",
				`Processing clip (${(videoBuffer.length / 1024).toFixed(0)}KB, ${durationMs}ms)`,
			);

			const startGemini = Date.now();
			const description = await describeVideo(
				videoBuffer,
				state.systemPrompt || undefined,
			);
			const geminiMs = Date.now() - startGemini;
			log("info", "gemini", `Description (${geminiMs}ms): ${description}`);

			broadcast({
				type: "description",
				text: description,
				latency: geminiMs,
			});

			const ttsBuffer = await textToSpeech(description);
			broadcast({
				type: "audio",
				buffer: ttsBuffer.toString(),
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
