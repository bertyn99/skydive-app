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

export default defineWebSocketHandler({
	open(peer) {
		registerClient(peer);
	},

	message(peer, message) {
		try {
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
