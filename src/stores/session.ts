import { defineStore } from "pinia";
import { shallowRef } from "vue";
import type { GameStateData } from "../../server/utils/protocol";
import {
	startCapture as browserStartCapture,
	stopCapture as browserStopCapture,
	recordClip,
} from "../utils/capture";
import { buildClipFrame } from "../utils/ws-binary";
import { startVoiceRecognition, type VoiceStatus } from "../utils/voice";

export interface LogEntry {
	id: number;
	level: "info" | "error" | "warn";
	source: string;
	message: string;
	timestamp: number;
}

interface AudioQueueItem {
	buffer: string;
	priority: "answer" | "ambient";
	text: string;
}

// Persistent AudioContext, unlocked once on user gesture
let audioCtx: AudioContext | null = null;
let currentAudioSource: AudioBufferSourceNode | null = null;
let stopVoiceFn: (() => void) | null = null;
let skipNextClip = false;
const CLIP_WS_BACKPRESSURE_BYTES = 1_500_000;
const FIRST_CLIP_DURATION_MS = 1500;
const MIN_CLIP_BYTES = 16 * 1024;

function getAudioContext(): AudioContext {
	if (!audioCtx) {
		audioCtx = new AudioContext();
	}
	return audioCtx;
}

export const useSessionStore = defineStore("session", () => {
	// Connection
	const ws = shallowRef<WebSocket | null>(null);
	const serverConnected = shallowRef(false);

	// Capture
	const mediaStream = shallowRef<MediaStream | null>(null);
	const isCapturing = shallowRef(false);
	const captureInterval = shallowRef(3000);

	// AI
	const lastDescription = shallowRef<string | null>(null);

	// Audio
	const isPlaying = shallowRef(false);
	const audioQueue = shallowRef<AudioQueueItem[]>([]);
	const nowPlayingText = shallowRef<string | null>(null);

	// Voice
	const voiceStatus = shallowRef<VoiceStatus>("off");
	const lastQuestion = shallowRef<string | null>(null);

	// Logs
	const logs = shallowRef<LogEntry[]>([]);
	const logCounter = shallowRef(0);

	// Mod context
	const gameState = shallowRef<GameStateData | null>(null);
	const gameStateReceivedAt = shallowRef<number | null>(null);

	function addLog(
		level: LogEntry["level"],
		source: string,
		message: string,
	): void {
		logCounter.value += 1;
		logs.value = [
			...logs.value.slice(-199),
			{
				id: logCounter.value,
				level,
				source,
				message,
				timestamp: Date.now(),
			},
		];
	}

	function sendCommand(command: string, value?: unknown): void {
		if (ws.value?.readyState === WebSocket.OPEN) {
			ws.value.send(JSON.stringify({ command, value }));
		}
	}

	function stopCurrentAudio(): void {
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
		isPlaying.value = false;
		audioQueue.value = [];
		nowPlayingText.value = null;
	}

	function playNextAudio(): void {
		if (isPlaying.value || audioQueue.value.length === 0) return;

		const [next, ...rest] = audioQueue.value;
		audioQueue.value = rest;
		isPlaying.value = true;
		nowPlayingText.value = `[${next.priority}] ${next.text}`;

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
					isPlaying.value = false;
					nowPlayingText.value = null;
					playNextAudio();
				};
				currentAudioSource = source;
				source.start();
			},
			() => {
				isPlaying.value = false;
				addLog("error", "audio", "Failed to decode audio clip");
				playNextAudio();
			},
		);
	}

	function clearLogs(): void {
		logs.value = [];
		logCounter.value = 0;
	}

	function startVoice(): void {
		if (stopVoiceFn) return; // already listening
		if (!ws.value || ws.value.readyState !== WebSocket.OPEN) {
			addLog("warn", "voice", "Cannot start voice: no WebSocket connection");
			return;
		}
		stopVoiceFn = startVoiceRecognition(
			{
				onQuestion: (text) => {
					addLog("info", "voice", `Question: ${text}`);
					lastQuestion.value = text;
					stopCurrentAudio();
				},
				onStatusChange: (status) => {
					voiceStatus.value = status;
				},
				isEnabled: () => isCapturing.value,
			},
			ws.value,
		);
		addLog("info", "voice", "Voice recognition started (wake word: Guide)");
	}

	function stopVoice(): void {
		if (stopVoiceFn) {
			stopVoiceFn();
			stopVoiceFn = null;
		}
		voiceStatus.value = "off";
	}

	function stopCapture(): void {
		if (mediaStream.value) {
			browserStopCapture(mediaStream.value);
		}
		isCapturing.value = false;
		mediaStream.value = null;
		stopCurrentAudio();
		sendCommand("stop");
		stopVoice();
		addLog("info", "capture", "Screen capture stopped");
	}

	function startCapture(): void {
		void (async () => {
			try {
				// Unlock AudioContext while we're still in the user gesture
				const ctx = getAudioContext();
				if (ctx.state === "suspended") {
					await ctx.resume();
				}

				const stream = await browserStartCapture();
				mediaStream.value = stream;
				isCapturing.value = true;

				sendCommand("start");
				addLog("info", "capture", "Screen capture started");

				// Auto-start voice recognition
				startVoice();

				// Stop capture if user clicks "Stop sharing" in browser chrome
				stream.getVideoTracks()[0].addEventListener("ended", () => {
					stopCapture();
				});

				// Capture loop — first clip is slightly longer to avoid zero-frame warmup clips.
				let isFirstClip = true;
				while (isCapturing.value && mediaStream.value === stream) {
					try {
						const interval = isFirstClip
							? FIRST_CLIP_DURATION_MS
							: captureInterval.value;
						isFirstClip = false;

						const startTime = Date.now();
						const buffer = await recordClip(stream, interval);
						if (!isCapturing.value) break;
						const elapsed = Date.now() - startTime;
						if (buffer.byteLength < MIN_CLIP_BYTES) {
							addLog(
								"warn",
								"capture",
								`Skipping tiny clip ${(buffer.byteLength / 1024).toFixed(0)}KB (likely encoder warmup)`,
							);
							continue;
						}

						// If voice input interrupted, skip sending this clip
						if (skipNextClip) {
							skipNextClip = false;
							addLog(
								"info",
								"capture",
								"Clip skipped — voice input reset interval",
							);
							continue;
						}

						addLog(
							"info",
							"capture",
							`Clip recorded in ${elapsed}ms (${(buffer.byteLength / 1024).toFixed(0)}KB)`,
						);

						if (ws.value?.readyState === WebSocket.OPEN) {
							if (
								ws.value.bufferedAmount > CLIP_WS_BACKPRESSURE_BYTES
							) {
								addLog(
									"warn",
									"capture",
									`Dropping clip due to websocket backpressure (${Math.round(ws.value.bufferedAmount / 1024)}KB buffered)`,
								);
								continue;
							}
							ws.value.send(buildClipFrame(buffer, interval));
						}
					} catch (err) {
						if (!isCapturing.value) break;
						addLog(
							"error",
							"capture",
							`Recording error: ${err instanceof Error ? err.message : String(err)}`,
						);
					}
				}
			} catch (err) {
				addLog(
					"error",
					"capture",
					`Failed to start capture: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		})();
	}

	function connect(): void {
		if (ws.value) return;

		const protocol =
			window.location.protocol === "https:" ? "wss:" : "ws:";
		const socket = new WebSocket(
			`${protocol}//${window.location.host}/_ws`,
		);

		socket.onopen = () => {
			serverConnected.value = true;
			addLog("info", "client", "Connected to server");
		};

		socket.onclose = () => {
			ws.value = null;
			serverConnected.value = false;
			addLog("warn", "client", "Disconnected from server");
			setTimeout(() => connect(), 2000);
		};

		socket.onerror = () => {
			addLog("error", "client", "WebSocket error");
		};

		socket.onmessage = (event) => {
			try {
				handleMessage(JSON.parse(event.data));
			} catch {
				// ignore parse errors
			}
		};

		ws.value = socket;
	}

	function disconnect(): void {
		if (ws.value) {
			ws.value.close();
			ws.value = null;
			serverConnected.value = false;
		}
	}

	function handleMessage(data: Record<string, unknown>): void {
		switch (data.type) {
			case "description":
				lastDescription.value = data.text as string;
				break;

			case "audio": {
				const incoming: AudioQueueItem = {
					buffer: data.buffer as string,
					priority: (data.priority as "answer" | "ambient") ?? "ambient",
					text: (data.text as string) ?? "",
				};
				const queued = audioQueue.value[0];
				if (
					isPlaying.value &&
					queued?.priority === "answer" &&
					incoming.priority === "ambient"
				) {
					// Don't replace a queued answer with ambient audio
					break;
				}
				audioQueue.value = [incoming];
				playNextAudio();
				break;
			}

			case "status":
				captureInterval.value = data.intervalMs as number;
				break;

			case "log":
				addLog(
					data.level as LogEntry["level"],
					data.source as string,
					data.message as string,
				);
				break;

			case "gameState":
				gameState.value = data.data as GameStateData;
				gameStateReceivedAt.value = Date.now();
				break;

			case "voice_question":
				lastQuestion.value = data.text as string;
				stopCurrentAudio();
				skipNextClip = true;
				addLog("info", "voice", `Question detected: ${data.text}`);
				break;

			case "voice_status":
				voiceStatus.value = data.status as VoiceStatus;
				break;
		}
	}

	return {
		// State
		ws,
		serverConnected,
		mediaStream,
		isCapturing,
		captureInterval,
		lastDescription,
		isPlaying,
		audioQueue,
		nowPlayingText,
		voiceStatus,
		lastQuestion,
		logs,
		gameState,
		gameStateReceivedAt,
		// Actions
		connect,
		disconnect,
		sendCommand,
		startCapture,
		stopCapture,
		startVoice,
		stopVoice,
		stopCurrentAudio,
		addLog,
		clearLogs,
		playNextAudio,
	};
});
