// Voice recognition via mic capture + server-side ElevenLabs STT
// Records while user speaks, sends complete utterance on silence detection

export type VoiceStatus = "off" | "listening" | "wake-detected";

export interface VoiceCallbacks {
	onQuestion: (text: string) => void;
	onStatusChange: (status: VoiceStatus) => void;
	isEnabled: () => boolean;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

// Volume threshold (0-255 range from getByteFrequencyData)
const SILENCE_THRESHOLD = 15;
// How long silence must last before we consider speech done (ms)
const SILENCE_DURATION = 500;
// How often we check volume levels (ms)
const CHECK_INTERVAL = 100;

export function startVoiceRecognition(
	callbacks: VoiceCallbacks,
	ws: WebSocket,
): () => void {
	let micStream: MediaStream | null = null;
	let stopped = false;
	let checkTimer: ReturnType<typeof setInterval> | null = null;
	let audioCtx: AudioContext | null = null;
	let analyser: AnalyserNode | null = null;

	// Recording state
	let recorder: MediaRecorder | null = null;
	let chunks: Blob[] = [];
	let isSpeaking = false;
	let silenceSince: number | null = null;

	const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
		? "audio/webm;codecs=opus"
		: "audio/webm";

	function getVolume(): number {
		if (!analyser) return 0;
		const data = new Uint8Array(analyser.frequencyBinCount);
		analyser.getByteFrequencyData(data);
		// Average volume across frequency bins
		let sum = 0;
		for (let i = 0; i < data.length; i++) {
			sum += data[i];
		}
		return sum / data.length;
	}

	function startRecorder() {
		if (!micStream || stopped) return;
		chunks = [];
		recorder = new MediaRecorder(micStream, { mimeType });
		recorder.ondataavailable = (event) => {
			if (event.data.size > 0) {
				chunks.push(event.data);
			}
		};
		recorder.onstop = async () => {
			if (stopped || chunks.length === 0) return;
			if (ws.readyState !== WebSocket.OPEN) return;

			const blob = new Blob(chunks, { type: mimeType });
			// Only send if there's meaningful audio (> 1KB to avoid empty headers)
			if (blob.size < 1024) return;

			const buffer = await blob.arrayBuffer();
			ws.send(
				JSON.stringify({
					command: "audio_chunk",
					audio: arrayBufferToBase64(buffer),
					mimeType,
				}),
			);
		};
		// Use timeslice to flush data periodically into chunks array
		recorder.start(1000);
	}

	function stopRecorderAndSend() {
		if (recorder && recorder.state !== "inactive") {
			recorder.stop();
		}
		recorder = null;
	}

	function checkVolume() {
		if (stopped) return;
		if (!callbacks.isEnabled()) {
			// Not enabled — reset state, don't record
			if (isSpeaking) {
				isSpeaking = false;
				silenceSince = null;
				stopRecorderAndSend();
			}
			return;
		}

		const volume = getVolume();
		const now = Date.now();

		if (volume > SILENCE_THRESHOLD) {
			// Sound detected
			silenceSince = null;
			if (!isSpeaking) {
				// Speech just started — begin recording
				isSpeaking = true;
				startRecorder();
			}
		} else if (isSpeaking) {
			// Was speaking, now silent
			if (silenceSince === null) {
				silenceSince = now;
			} else if (now - silenceSince >= SILENCE_DURATION) {
				// Silence lasted long enough — utterance is complete
				isSpeaking = false;
				silenceSince = null;
				stopRecorderAndSend();
			}
		}
	}

	async function start() {
		try {
			micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

			// Set up audio analysis for volume detection
			audioCtx = new AudioContext();
			analyser = audioCtx.createAnalyser();
			analyser.fftSize = 512;
			analyser.smoothingTimeConstant = 0.3;
			const source = audioCtx.createMediaStreamSource(micStream);
			source.connect(analyser);

			// Monitor volume on an interval
			checkTimer = setInterval(checkVolume, CHECK_INTERVAL);

			callbacks.onStatusChange("listening");
			console.log("[voice] Mic capture started (silence detection mode)");
		} catch (err) {
			console.error("[voice] Failed to start mic capture:", err);
			callbacks.onStatusChange("off");
		}
	}

	start();

	return () => {
		stopped = true;
		if (checkTimer) {
			clearInterval(checkTimer);
			checkTimer = null;
		}
		if (recorder && recorder.state !== "inactive") {
			try {
				recorder.stop();
			} catch {
				// ignore
			}
		}
		if (audioCtx) {
			audioCtx.close();
			audioCtx = null;
		}
		if (micStream) {
			for (const track of micStream.getTracks()) {
				track.stop();
			}
			micStream = null;
		}
		analyser = null;
		recorder = null;
		callbacks.onStatusChange("off");
		console.log("[voice] Mic capture stopped");
	};
}
