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

export type SourceKind = "screen" | "video-file";

/** Provenance chip (Stage 4): which engine produced an output, how fast. */
export interface ProvenanceChip {
	tier: "gate" | "tts" | "stt";
	engine: string;
	latencyMs: number;
	relevance?: number;
	cached?: boolean;
	fallbackFrom?: string | null;
}

export interface TtsProvenance {
	engine: string;
	latencyMs: number;
	cached?: boolean;
	fallbackFrom?: string | null;
}

export const TTS_ENGINE_OPTIONS = [
	{ label: "ElevenLabs (cloud)", value: "elevenlabs" },
	{ label: "Mistral Voxtral (cloud)", value: "mistral" },
	{ label: "Piper (local, fr_FR)", value: "piper-local" },
] as const;

export const STT_ENGINE_OPTIONS = [
	{ label: "ElevenLabs Scribe (cloud)", value: "elevenlabs" },
	{ label: "Whisper (local server)", value: "whisper-local" },
] as const;

interface AudioQueueItem {
	buffer: string;
	priority: "answer" | "ambient";
	text: string;
	tts: TtsProvenance | null;
}

// Persistent AudioContext, unlocked once on user gesture
let audioCtx: AudioContext | null = null;
let currentAudioSource: AudioBufferSourceNode | null = null;
let stopVoiceFn: (() => void) | null = null;
let skipNextClip = false;
const CLIP_WS_BACKPRESSURE_BYTES = 1_500_000;
const FIRST_CLIP_DURATION_MS = 1500;
const MIN_CLIP_BYTES = 16 * 1024;
const PAUSED_POLL_MS = 200;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

	// Source (glossary: Live session = screen, Simulation session = video file)
	const source = shallowRef<SourceKind>("screen");
	const videoFileStream = shallowRef<MediaStream | null>(null);
	const videoPlaying = shallowRef(false);

	// Capture
	const mediaStream = shallowRef<MediaStream | null>(null);
	const isCapturing = shallowRef(false);
	const captureInterval = shallowRef(3000);

	// AI
	const lastDescription = shallowRef<string | null>(null);
	const lastProvenance = shallowRef<ProvenanceChip | null>(null);

	// Engine seams (Stage 4) — mirrored from the server's status broadcasts
	const ttsEngine = shallowRef<string>("elevenlabs");
	const sttEngine = shallowRef<string>("elevenlabs");

	// Audio
	const isPlaying = shallowRef(false);
	const audioQueue = shallowRef<AudioQueueItem[]>([]);
	const nowPlayingText = shallowRef<string | null>(null);
	const nowPlayingTts = shallowRef<AudioQueueItem["tts"]>(null);
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
		nowPlayingTts.value = null;
	}

	function playNextAudio(): void {
		if (isPlaying.value || audioQueue.value.length === 0) return;

		const [next, ...rest] = audioQueue.value;
		audioQueue.value = rest;
		isPlaying.value = true;
		nowPlayingText.value = `[${next.priority}] ${next.text}`;
		nowPlayingTts.value = next.tts;

		const ctx = getAudioContext();
		const raw = atob(next.buffer);
		const bytes = new Uint8Array(raw.length);
		for (let i = 0; i < raw.length; i++) {
			bytes[i] = raw.charCodeAt(i);
		}

		ctx
			.decodeAudioData(bytes.buffer)
			.then((audioBuffer) => {
				const source = ctx.createBufferSource();
				source.buffer = audioBuffer;
				source.connect(ctx.destination);
				source.onended = () => {
					currentAudioSource = null;
					isPlaying.value = false;
					nowPlayingText.value = null;
					nowPlayingTts.value = null;
					playNextAudio();
				};
				currentAudioSource = source;
				source.start();
			})
			.catch(() => {
				isPlaying.value = false;
				nowPlayingTts.value = null;
				addLog("error", "audio", "Failed to decode audio clip");
				playNextAudio();
			});
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
		addLog("info", "capture", "Capture stopped");
	}

	/**
	 * Records clips from `stream` and ships them over the WS pipeline until
	 * the capture stops or the stream is replaced. Shared by both sources:
	 * screen capture and video-file `captureStream()`.
	 */
	function runClipLoop(stream: MediaStream): void {
		void (async () => {
			// First clip is slightly longer to avoid zero-frame warmup clips.
			let isFirstClip = true;
			while (isCapturing.value && mediaStream.value === stream) {
				try {
					// Sim source: a paused video has nothing new to say.
					if (source.value === "video-file" && !videoPlaying.value) {
						await sleep(PAUSED_POLL_MS);
						continue;
					}

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
		})();
	}

	function beginSession(stream: MediaStream): void {
		mediaStream.value = stream;
		isCapturing.value = true;
		sendCommand("start");
		addLog("info", "capture", `Capture started (${source.value})`);
		// Auto-start voice recognition
		startVoice();
		runClipLoop(stream);
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
				beginSession(stream);

				// Stop capture if user clicks "Stop sharing" in browser chrome
				stream.getVideoTracks()[0].addEventListener("ended", () => {
					stopCapture();
				});
			} catch (err) {
				addLog(
					"error",
					"capture",
					`Failed to start capture: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		})();
	}

	function startVideoFileCapture(): void {
		void (async () => {
			try {
				// Unlock AudioContext while we're still in the user gesture
				const ctx = getAudioContext();
				if (ctx.state === "suspended") {
					await ctx.resume();
				}

				const stream = videoFileStream.value;
				if (!stream) {
					addLog(
						"warn",
						"capture",
						"Cannot start sim capture: no video file loaded",
					);
					return;
				}

				beginSession(stream);

				if (!videoPlaying.value) {
					addLog(
						"info",
						"capture",
						"Video paused — press play to stream clips",
					);
				}
			} catch (err) {
				addLog(
					"error",
					"capture",
					`Failed to start sim capture: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		})();
	}

	function setSource(kind: SourceKind): void {
		if (source.value === kind) return;
		if (isCapturing.value) {
			stopCapture();
		}
		source.value = kind;
		addLog("info", "session", `Source set to ${kind}`);
	}

	function setVideoFileStream(stream: MediaStream | null): void {
		if (isCapturing.value && source.value === "video-file") {
			stopCapture();
		}
		videoFileStream.value = stream;
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
				lastProvenance.value = (data.provenance as ProvenanceChip | undefined) ?? null;
				break;

			case "audio": {
				const incoming: AudioQueueItem = {
					buffer: data.buffer as string,
					priority: (data.priority as "answer" | "ambient") ?? "ambient",
					text: (data.text as string) ?? "",
					tts: (data.provenance as TtsProvenance | undefined) ?? null,
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
				if (typeof data.ttsEngine === "string") {
					ttsEngine.value = data.ttsEngine;
				}
				if (typeof data.sttEngine === "string") {
					sttEngine.value = data.sttEngine;
				}
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

	function setEngines(kind: "tts" | "stt", engine: string): void {
		if (kind === "tts") {
			ttsEngine.value = engine;
			sendCommand("setTtsEngine", engine);
		} else {
			sttEngine.value = engine;
			sendCommand("setSttEngine", engine);
		}
		addLog("info", "engine", `${kind.toUpperCase()} engine set to ${engine}`);
	}

	return {
		// State
		ws,
		serverConnected,
		source,
		videoFileStream,
		videoPlaying,
		mediaStream,
		isCapturing,
		captureInterval,
		lastDescription,
		lastProvenance,
		ttsEngine,
		sttEngine,
		isPlaying,
		audioQueue,
		nowPlayingText,
		nowPlayingTts,
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
		startVideoFileCapture,
		stopCapture,
		setSource,
		setVideoFileStream,
		setEngines,
		startVoice,
		stopVoice,
		stopCurrentAudio,
		addLog,
		clearLogs,
		playNextAudio,
	};
});
