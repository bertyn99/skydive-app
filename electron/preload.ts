// Exposed as window.skyguide (typed in src/utils/electron-bridge.ts). The
// player shell only forwards push-to-talk toggles to the renderer —
// everything else (capture, WS, audio out) is plain web code shared with the
// dashboard.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("skyguide", {
	platform: process.platform,
	/** Global push-to-talk toggle from the Electron main process. */
	onPtt: (callback: (action: "start" | "stop") => void): void => {
		ipcRenderer.on("skyguide:ptt", (_event, action: unknown) => {
			if (action === "start" || action === "stop") callback(action);
		});
	},
});
