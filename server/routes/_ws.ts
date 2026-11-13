import { defineWebSocketHandler } from "nitro";
import {
	processAudioChunk,
	processClip,
	processQuestion,
	registerClient,
	start,
	stop,
	unregisterClient,
	updateConfig,
} from "../utils/engine";

const CLIP_FRAME_TYPE = 1;
const AUDIO_FRAME_TYPE = 2;
const AUDIO_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"];

function handleBinaryFrame(data: Uint8Array): boolean {
	if (data.byteLength === 0) return true;
	const frameType = data[0];

	if (frameType === CLIP_FRAME_TYPE) {
		if (data.byteLength <= 5) return true;
		const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
		const durationMs = view.getUint32(1, true);
		const payload = data.subarray(5);
		processClip(Buffer.from(payload), durationMs);
		return true;
	}

	if (frameType === AUDIO_FRAME_TYPE) {
		if (data.byteLength <= 2) return true;
		const mimeId = data[1] ?? 1;
		const mimeType = AUDIO_MIME_TYPES[mimeId] ?? "audio/webm";
		const payload = data.subarray(2);
		processAudioChunk(Buffer.from(payload), mimeType);
		return true;
	}

	return false;
}

export default defineWebSocketHandler({
	open(peer) {
		registerClient(peer);
	},

	message(peer, message) {
		try {
			const msgData = (message as { data?: unknown }).data;
			if (typeof msgData !== "string") {
				if (handleBinaryFrame(message.uint8Array())) {
					return;
				}
			}

			const data = JSON.parse(message.text());

			switch (data.command) {
				case "start":
					start();
					break;
				case "stop":
					stop();
					break;
				case "clip":
					if (typeof data.video === "string") {
						const buffer = Buffer.from(data.video, "base64");
						processClip(buffer, data.durationMs ?? 0);
					}
					break;
				case "setInterval":
					if (typeof data.value === "number") {
						updateConfig({ intervalMs: data.value });
					}
					break;
				case "setPrompt":
					if (typeof data.value === "string") {
						updateConfig({ systemPrompt: data.value });
					}
					break;
				case "setTtsEngine":
					if (typeof data.value === "string") {
						updateConfig({ ttsEngine: data.value });
					}
					break;
				case "setPipeline":
					if (typeof data.value === "string") {
						updateConfig({ pipeline: data.value });
					}
					break;
				case "setGateEngine":
					if (typeof data.value === "string") {
						updateConfig({ gateEngine: data.value });
					}
					break;
				case "setSttEngine":
					if (typeof data.value === "string") {
						updateConfig({ sttEngine: data.value });
					}
					break;
				case "question":
					if (typeof data.text === "string" && data.text.trim()) {
						processQuestion(data.text.trim());
					}
					break;
				case "audio_chunk":
					if (typeof data.audio === "string") {
						const audioBuffer = Buffer.from(data.audio, "base64");
						processAudioChunk(
							audioBuffer,
							typeof data.mimeType === "string"
								? data.mimeType
								: "audio/webm",
						);
					}
					break;
				default:
					peer.send(
						JSON.stringify({
							type: "error",
							message: `Unknown command: ${data.command}`,
						}),
					);
			}
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			peer.send(
				JSON.stringify({
					type: "error",
					message: `Invalid message: ${errorMessage}`,
				}),
			);
		}
	},

	close(peer) {
		unregisterClient(peer);
	},
});
