import { create } from "zustand";
import type { GameStateData } from "../../server/utils/protocol";
import {
	startCapture as browserStartCapture,
	stopCapture as browserStopCapture,
	recordClip,
} from "../utils/capture";

export interface LogEntry {
	id: number;
	level: "info" | "error" | "warn";
	source: string;
	message: string;
	timestamp: number;
}

interface AppState {
	// Connection
	ws: WebSocket | null;
	serverConnected: boolean;

	// Capture
	mediaStream: MediaStream | null;
	isCapturing: boolean;
	captureInterval: number;

	// AI
	lastDescription: string | null;

	// Audio
	isPlaying: boolean;
	audioQueue: string[];

	// Logs
	logs: LogEntry[];
	logCounter: number;
	gameState: GameStateData | null;
	gameStateReceivedAt: number | null;

	// Actions
	connect: () => void;
	disconnect: () => void;
	sendCommand: (command: string, value?: unknown) => void;
	startCapture: () => Promise<void>;
	stopCapture: () => void;
	addLog: (level: LogEntry["level"], source: string, message: string) => void;
	clearLogs: () => void;
	setIsPlaying: (playing: boolean) => void;
	playNextAudio: () => void;
}

// Persistent AudioContext, unlocked once on user gesture
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
	if (!audioCtx) {
		audioCtx = new AudioContext();
	}
	return audioCtx;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

export const useAppStore = create<AppState>((set, get) => ({
	ws: null,
	serverConnected: false,
	mediaStream: null,
	isCapturing: false,
	captureInterval: 3000,
	lastDescription: null,
	isPlaying: false,
	audioQueue: [],
	logs: [],
	logCounter: 0,
	gameState: null,
	gameStateReceivedAt: null,

	connect: () => {
		const { ws } = get();
		if (ws) return;

		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const socket = new WebSocket(`${protocol}//${window.location.host}/_ws`);

		socket.onopen = () => {
			set({ serverConnected: true });
			get().addLog("info", "client", "Connected to server");
		};

		socket.onclose = () => {
			set({ ws: null, serverConnected: false });
			get().addLog("warn", "client", "Disconnected from server");
			setTimeout(() => get().connect(), 2000);
		};

		socket.onerror = () => {
			get().addLog("error", "client", "WebSocket error");
		};

		socket.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);
				handleMessage(data, set, get);
			} catch {
				// ignore parse errors
			}
		};

		set({ ws: socket });
	},

	disconnect: () => {
		const { ws } = get();
		if (ws) {
			ws.close();
			set({ ws: null, serverConnected: false });
		}
	},

	sendCommand: (command: string, value?: unknown) => {
		const { ws } = get();
		if (ws?.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ command, value }));
		}
	},

	startCapture: async () => {
		try {
			// Unlock AudioContext while we're still in the user gesture
			const ctx = getAudioContext();
			if (ctx.state === "suspended") {
				await ctx.resume();
			}

			const stream = await browserStartCapture();
			set({ mediaStream: stream, isCapturing: true });

			get().sendCommand("start");
			get().addLog("info", "capture", "Screen capture started");

			// Stop capture if user clicks "Stop sharing" in browser chrome
			stream.getVideoTracks()[0].addEventListener("ended", () => {
				get().stopCapture();
			});

			// Capture loop
			(async () => {
				while (get().isCapturing && get().mediaStream === stream) {
					try {
						const interval = get().captureInterval;
						const startTime = Date.now();
						const buffer = await recordClip(stream, interval);
						const elapsed = Date.now() - startTime;

						get().addLog(
							"info",
							"capture",
							`Clip recorded in ${elapsed}ms (${(buffer.byteLength / 1024).toFixed(0)}KB)`,
						);

						const { ws } = get();
						if (ws?.readyState === WebSocket.OPEN) {
							ws.send(
								JSON.stringify({
									command: "clip",
									video: arrayBufferToBase64(buffer),
									durationMs: interval,
								}),
							);
						}
					} catch (err) {
						if (!get().isCapturing) break;
						get().addLog(
							"error",
							"capture",
							`Recording error: ${err instanceof Error ? err.message : String(err)}`,
						);
					}
				}
			})();
		} catch (err) {
			get().addLog(
				"error",
				"capture",
				`Failed to start capture: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	},

	stopCapture: () => {
		const { mediaStream } = get();
		if (mediaStream) {
			browserStopCapture(mediaStream);
		}
		set({ isCapturing: false, mediaStream: null });
		get().sendCommand("stop");
		get().addLog("info", "capture", "Screen capture stopped");
	},

	addLog: (level, source, message) => {
		set((s) => ({
			logCounter: s.logCounter + 1,
			logs: [
				...s.logs.slice(-199),
				{ id: s.logCounter + 1, level, source, message, timestamp: Date.now() },
			],
		}));
	},

	clearLogs: () => set({ logs: [], logCounter: 0 }),

	setIsPlaying: (playing) => set({ isPlaying: playing }),

	playNextAudio: () => {
		const { audioQueue, isPlaying } = get();
		if (isPlaying || audioQueue.length === 0) return;

		const [next, ...rest] = audioQueue;
		set({ audioQueue: rest, isPlaying: true });

		const ctx = getAudioContext();
		const raw = atob(next);
		const bytes = new Uint8Array(raw.length);
		for (let i = 0; i < raw.length; i++) {
			bytes[i] = raw.charCodeAt(i);
		}

		ctx.decodeAudioData(
			bytes.buffer,
			(audioBuffer) => {
				const source = ctx.createBufferSource();
				source.buffer = audioBuffer;
				source.connect(ctx.destination);
				source.onended = () => {
					set({ isPlaying: false });
					get().playNextAudio();
				};
				source.start();
			},
			() => {
				set({ isPlaying: false });
				get().addLog("error", "audio", "Failed to decode audio clip");
				get().playNextAudio();
			},
		);
	},
}));

function handleMessage(
	data: Record<string, unknown>,
	set: (
		partial: Partial<AppState> | ((s: AppState) => Partial<AppState>),
	) => void,
	get: () => AppState,
) {
	switch (data.type) {
		case "description":
			set({ lastDescription: data.text as string });
			break;

		case "audio":
			set((s) => ({ audioQueue: [...s.audioQueue, data.buffer as string] }));
			get().playNextAudio();
			break;

		case "status":
			set({
				captureInterval: data.intervalMs as number,
			});
			break;

		case "log":
			get().addLog(
				data.level as LogEntry["level"],
				data.source as string,
				data.message as string,
			);
			break;

		case "gameState":
			set({
				gameState: data.data as GameStateData,
				gameStateReceivedAt: Date.now(),
			});
			break;
	}
}
