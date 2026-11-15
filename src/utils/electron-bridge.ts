// Typed access to the Electron player bridge (electron/preload.ts). Absent
// in plain browsers — every helper degrades to a no-op so the shared session
// code stays browser-clean.

export interface SkyguideBridge {
	platform: string;
	/** Push-to-talk toggle from the global shortcut (main process). */
	onPtt(callback: (action: "start" | "stop") => void): void;
}

declare global {
	interface Window {
		skyguide?: SkyguideBridge;
	}
}

export function playerShell(): SkyguideBridge | null {
	if (typeof window === "undefined") return null;
	return window.skyguide ?? null;
}
