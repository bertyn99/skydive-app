import { create } from "zustand";
import type { GameStateData } from "../../server/utils/protocol";
import {
	startCapture as browserStartCapture,
	stopCapture as browserStopCapture,
	recordClip,
} from "../utils/capture";
import {
	startVoiceRecognition,
	type VoiceStatus,
} from "../utils/voice";

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
	audioQueue: Array<{ buffer: string; priority: "answer" | "ambient"; text: string }>;
	nowPlayingText: string | null;

	// Voice
	voiceStatus: VoiceStatus;
	lastQuestion: string | null;

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
	startVoice: () => void;
	stopVoice: () => void;
	stopCurrentAudio: () => void;
	addLog: (level: LogEntry["level"], source: string, message: string) => void;
	clearLogs: () => void;
	setIsPlaying: (playing: boolean) => void;
	playNextAudio: () => void;
}

// Persistent AudioContext, unlocked once on user gesture
let audioCtx: AudioContext | null = null;
let currentAudioSource: AudioBufferSourceNode | null = null;
let stopVoiceFn: (() => void) | null = null;

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
	nowPlayingText: null,
	voiceStatus: "off" as VoiceStatus,
	lastQuestion: null,
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

			// Auto-start voice recognition
			get().startVoice();

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
		get().stopVoice();
		get().addLog("info", "capture", "Screen capture stopped");
	},

	startVoice: () => {
		if (stopVoiceFn) return; // already listening
		const { ws } = get();
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			get().addLog("warn", "voice", "Cannot start voice: no WebSocket connection");
			return;
		}
		stopVoiceFn = startVoiceRecognition(
			{
				onQuestion: (text) => {
					get().addLog("info", "voice", `Question: ${text}`);
					set({ lastQuestion: text });
					get().stopCurrentAudio();
				},
				onStatusChange: (status) => {
					set({ voiceStatus: status });
				},
				isEnabled: () => get().isCapturing,
			},
			ws,
		);
		get().addLog("info", "voice", "Voice recognition started (wake word: Guide)");
	},

	stopVoice: () => {
		if (stopVoiceFn) {
			stopVoiceFn();
			stopVoiceFn = null;
		}
		set({ voiceStatus: "off" as VoiceStatus });
	},

	stopCurrentAudio: () => {
		// Stop currently playing audio and clear queue
		if (currentAudioSource) {
			try {
				currentAudioSource.onended = null;
				currentAudioSource.stop();
			} catch {
				// may already be stopped
			}
			currentAudioSource = null;
		}
		set({ isPlaying: false, audioQueue: [], nowPlayingText: null });
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
		set({ audioQueue: rest, isPlaying: true, nowPlayingText: `[${next.priority}] ${next.text}` });

		const ctx = getAudioContext();
		const raw = atob(next.buffer);
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
					currentAudioSource = null;
					set({ isPlaying: false, nowPlayingText: null });
					get().playNextAudio();
				};
				currentAudioSource = source;
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

		case "audio": {
			const incoming = {
				buffer: data.buffer as string,
				priority: (data.priority as "answer" | "ambient") ?? "ambient",
				text: (data.text as string) ?? "",
			};
			const { isPlaying, audioQueue } = get();
			if (isPlaying) {
				const queued = audioQueue[0];
				if (queued?.priority === "answer" && incoming.priority === "ambient") {
					// Don't replace a queued answer with ambient audio
					break;
				}
				set({ audioQueue: [incoming] });
			} else {
				set({ audioQueue: [incoming] });
				get().playNextAudio();
			}
			break;
		}

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

		case "voice_question":
			set({ lastQuestion: data.text as string });
			get().stopCurrentAudio();
			get().addLog("info", "voice", `Question detected: ${data.text}`);
			break;

		case "voice_status":
			set({ voiceStatus: data.status as VoiceStatus });
			break;
	}
}
