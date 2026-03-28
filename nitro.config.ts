import { defineNitroConfig } from "nitro/config";

export default defineNitroConfig({
	serverDir: "./server",
	experimental: {
		websocket: true,
	},
});
