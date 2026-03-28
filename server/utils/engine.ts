import type { Peer } from "crossws";
import { captureScreen } from "./capture";
import { describeFrame } from "./gemini";

interface EngineState {
	isRunning: boolean;
	intervalMs: number;
	systemPrompt: string;
	clients: Set<Peer>;
	timer: ReturnType<typeof setInterval> | null;
	processing: boolean;
}

const state: EngineState = {
	isRunning: false,
	intervalMs: 3000,
	systemPrompt: "",
	clients: new Set(),
	timer: null,
	processing: false,
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

async function tick() {
	if (state.processing) {
		log("warn", "engine", "Previous tick still processing, skipping");
		return;
	}

	state.processing = true;

	try {
		// 1. Capture screen
		const startCapture = Date.now();
		const frame = await captureScreen();
		const captureMs = Date.now() - startCapture;
		log("info", "capture", `Screen captured in ${captureMs}ms`);

		// 2. Broadcast frame to dashboard
		broadcast({
			type: "frame",
			base64: frame.base64,
			timestamp: frame.timestamp,
		});

		// 3. Describe with Gemini
		const startGemini = Date.now();
		const description = await describeFrame(
			frame.base64,
			state.systemPrompt || undefined,
		);
		const geminiMs = Date.now() - startGemini;
		log("info", "gemini", `Description (${geminiMs}ms): ${description}`);

		broadcast({
			type: "description",
			text: description,
			latency: geminiMs,
		});

		// 4. TTS with Mistral
		// const startTts = Date.now();
		// const audioBase64 = await textToSpeech(description);
		// const ttsMs = Date.now() - startTts;
		// log("info", "tts", `Audio generated in ${ttsMs}ms`);

		// broadcast({
		// 	type: "audio",
		// 	data: audioBase64,
		// 	description,
		// 	latency: ttsMs,
		// });
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		log("error", "engine", `Tick error: ${msg}`);
	} finally {
		state.processing = false;
	}
}

export function start() {
	if (state.isRunning) return;
	state.isRunning = true;
	log(
		"info",
		"engine",
		`Starting capture loop (${state.intervalMs}ms interval)`,
	);

	// Run first tick immediately
	tick();
	state.timer = setInterval(tick, state.intervalMs);

	broadcast({ type: "status", isRunning: true, intervalMs: state.intervalMs });
}

export function stop() {
	if (!state.isRunning) return;
	state.isRunning = false;

	if (state.timer) {
		clearInterval(state.timer);
		state.timer = null;
	}

	log("info", "engine", "Capture loop stopped");
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

		// Restart timer if running
		if (state.isRunning && state.timer) {
			clearInterval(state.timer);
			state.timer = setInterval(tick, state.intervalMs);
		}
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

	// Send current state to new client
	peer.send(
		JSON.stringify({
			type: "status",
			isRunning: state.isRunning,
			intervalMs: state.intervalMs,
		}),
	);
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
