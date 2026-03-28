import type { Peer } from "crossws";
import { recordClip } from "./capture";
import { clearHistory, describeVideo } from "./gemini";

interface EngineState {
	isRunning: boolean;
	intervalMs: number;
	systemPrompt: string;
	clients: Set<Peer>;
	abortController: AbortController | null;
}

const state: EngineState = {
	isRunning: false,
	intervalMs: 3000,
	systemPrompt: "",
	clients: new Set(),
	abortController: null,
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

async function loop(signal: AbortSignal) {
	while (!signal.aborted) {
		try {
			// 1. Record video clip for intervalMs duration
			const startCapture = Date.now();
			log("info", "capture", `Recording ${state.intervalMs}ms clip...`);
			const clip = await recordClip(state.intervalMs);
			const captureMs = Date.now() - startCapture;
			log("info", "capture", `Clip recorded in ${captureMs}ms (${(clip.sizeBytes / 1024).toFixed(0)}KB)`);

			if (signal.aborted) break;

			// 2. Broadcast thumbnail to dashboard
			broadcast({
				type: "frame",
				base64: clip.thumbnail.toString("base64"),
				timestamp: clip.timestamp,
			});

			// 3. Describe with Gemini
			const startGemini = Date.now();
			const description = await describeVideo(
				clip.video,
				state.systemPrompt || undefined,
			);
			const geminiMs = Date.now() - startGemini;
			log("info", "gemini", `Description (${geminiMs}ms): ${description}`);

			broadcast({
				type: "description",
				text: description,
				latency: geminiMs,
			});

			// 4. TTS with Mistral (commented out)
			// try {
			// 	const startTts = Date.now();
			// 	const audioBase64 = await textToSpeech(description);
			// 	const ttsMs = Date.now() - startTts;
			// 	log("info", "tts", `Audio generated in ${ttsMs}ms`);
			// 	broadcast({ type: "audio", data: audioBase64, description, latency: ttsMs });
			// } catch (ttsErr: unknown) {
			// 	const ttsMsg = ttsErr instanceof Error ? ttsErr.message : String(ttsErr);
			// 	log("error", "tts", `TTS error: ${ttsMsg}`);
			// }
		} catch (err: unknown) {
			if (signal.aborted) break;
			const msg = err instanceof Error ? err.message : String(err);
			log("error", "engine", `Tick error: ${msg}`);
		}
	}
}

export function start() {
	if (state.isRunning) return;
	state.isRunning = true;
	log(
		"info",
		"engine",
		`Starting video capture loop (${state.intervalMs}ms clips)`,
	);

	state.abortController = new AbortController();
	loop(state.abortController.signal);

	broadcast({ type: "status", isRunning: true, intervalMs: state.intervalMs });
}

export function stop() {
	if (!state.isRunning) return;
	state.isRunning = false;

	if (state.abortController) {
		state.abortController.abort();
		state.abortController = null;
	}

	clearHistory();
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
