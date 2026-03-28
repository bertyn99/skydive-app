import { create } from "zustand";

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
	currentFrame: string | null;
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

	// Actions
	connect: () => void;
	disconnect: () => void;
	sendCommand: (command: string, value?: unknown) => void;
	addLog: (level: LogEntry["level"], source: string, message: string) => void;
	clearLogs: () => void;
	setIsPlaying: (playing: boolean) => void;
	playNextAudio: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
	ws: null,
	serverConnected: false,
	currentFrame: null,
	isCapturing: false,
	captureInterval: 3000,
	lastDescription: null,
	isPlaying: false,
	audioQueue: [],
	logs: [],
	logCounter: 0,

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
			// Auto-reconnect after 2s
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

		const audio = new Audio(`data:audio/mp3;base64,${next}`);
		audio.onended = () => {
			set({ isPlaying: false });
			get().playNextAudio();
		};
		audio.onerror = () => {
			set({ isPlaying: false });
			get().addLog("error", "audio", "Failed to play audio clip");
			get().playNextAudio();
		};
		audio.play().catch(() => {
			set({ isPlaying: false });
			get().addLog(
				"error",
				"audio",
				"Audio playback blocked (user interaction required)",
			);
		});
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
		case "frame":
			set({ currentFrame: data.base64 as string });
			break;

		case "description":
			set({ lastDescription: data.text as string });
			break;

		case "audio":
			set((s) => ({ audioQueue: [...s.audioQueue, data.data as string] }));
			get().playNextAudio();
			break;

		case "status":
			set({
				isCapturing: data.isRunning as boolean,
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
	}
}
