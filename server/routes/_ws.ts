import { defineWebSocketHandler } from "nitro";
import {
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
				default:
					peer.send(
						JSON.stringify({
							type: "error",
							message: `Unknown command: ${data.command}`,
						}),
					);
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
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
