// SkyGuide player runtime (Stage 7 / YGG-249): the Electron shell for the
// blind player. One app, two surfaces — the web dashboard stays the
// operator/dev surface; this shell runs the SAME session core invisibly
// (audio out + global push-to-talk) while the Nitro sidecar serves it.
//
//   main.ts    lifecycle: sidecar (attach in dev / spawn in prod), health
//              check + restart, hidden window, tray, autostart,
//              desktopCapturer /skyrim/i auto-source, global PTT shortcut
//   preload.ts contextBridge (window.skyguide)
//
// The renderer needs zero Electron awareness outside
// src/utils/electron-bridge.ts: the displayMedia request handler below
// intercepts the existing getDisplayMedia call in capture.ts and auto-picks
// the Skyrim window — no picker UI for a blind player.

import {
	app,
	BrowserWindow,
	desktopCapturer,
	globalShortcut,
	Menu,
	nativeImage,
	session,
	Tray,
	type MenuItemConstructorOptions,
} from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// --- Configuration -----------------------------------------------------------

const PORT = Number(process.env.SKYGUIDE_PORT ?? 3000);
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/config`;
/** Window/source title match for the game (LIFT-PLAN: /skyrim/i). */
const SKYRIM_SOURCE_RE = /skyrim/i;
/**
 * Push-to-talk accelerator. F9 default was dropped: OEM tools (MyASUS,
 * Armoury Crate, McAfee) hook F9 on several machines and it locked the
 * Windows screen mid-game. F7 is unused by vanilla Skyrim UI and by
 * skymp's companion page (which owns F6). Override with
 * SKYGUIDE_PTT_KEY (Electron accelerator syntax, e.g. "F8" or
 * "CommandOrControl+Shift+Space").
 */
const PTT_ACCELERATOR = process.env.SKYGUIDE_PTT_KEY ?? "F7";
const SIDECAR_RESTART_MAX = 5;
const SIDECAR_RESTART_DELAY_MS = 2000;
const HEALTH_TIMEOUT_MS = 30_000;

// 16×16 teal PNG, embedded as a fallback when the app icon file is missing
// (packaging ships the real branding via extraResources — see appIconPath).
const TRAY_ICON_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGklEQVR4nGMQ2bHsPyWYYdSAUQNGDRguBgAAftxxHyGKMRkAAAAASUVORK5CYII=";

/** Branding icon: resources/icon.png when packaged, repo build/ when dev. */
function appIconPath(): string {
	return app.isPackaged
		? join(process.resourcesPath, "icon.png")
		: join(import.meta.dirname, "..", "build", "icon.png");
}

// --- State -------------------------------------------------------------------

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let sidecar: ChildProcess | null = null;
let quitting = false;
let sidecarRestartAttempts = 0;
let pttActive = false;

interface PlayerSettings {
	autostart: boolean;
}

function settingsPath(): string {
	return join(app.getPath("userData"), "player-settings.json");
}

function readSettings(): PlayerSettings {
	try {
		const raw = JSON.parse(readFileSync(settingsPath(), "utf8")) as PlayerSettings;
		return { autostart: raw.autostart === true };
	} catch {
		return { autostart: false };
	}
}

function writeSettings(settings: PlayerSettings): void {
	writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
}

// --- Sidecar (Nitro) -----------------------------------------------------------

/**
 * Production: run the packaged Nitro build with Electron's own Node runtime
 * (ELECTRON_RUN_AS_NODE) — no system Node on the player machine. Dev: the
 * vite dev server already runs Nitro in-process, so there is nothing to
 * spawn — the health check just attaches to it.
 */
function sidecarEntry(): string | null {
	if (app.isPackaged) {
		return join(process.resourcesPath, "nitro", "server", "index.mjs");
	}
	return null;
}

function spawnSidecar(): void {
	const entry = sidecarEntry();
	if (!entry) return;
	console.log(`[player] starting nitro sidecar: ${entry} (port ${PORT})`);
	sidecar = spawn(process.execPath, [entry], {
		env: {
			...process.env,
			ELECTRON_RUN_AS_NODE: "1",
			NITRO_PORT: String(PORT),
			NODE_ENV: "production",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	sidecar.stdout?.on("data", (chunk: Buffer) => process.stdout.write(`[nitro] ${chunk}`));
	sidecar.stderr?.on("data", (chunk: Buffer) => process.stderr.write(`[nitro] ${chunk}`));
	sidecar.on("exit", (code) => {
		sidecar = null;
		if (quitting) return;
		console.error(`[player] sidecar exited (code ${code})`);
		void restartSidecar();
	});
}

async function restartSidecar(): Promise<void> {
	if (sidecarRestartAttempts >= SIDECAR_RESTART_MAX) {
		console.error("[player] sidecar restart budget exhausted — staying down");
		return;
	}
	sidecarRestartAttempts += 1;
	const delay = SIDECAR_RESTART_DELAY_MS * sidecarRestartAttempts;
	console.log(`[player] restarting sidecar in ${delay}ms (attempt ${sidecarRestartAttempts})`);
	await new Promise((resolve) => setTimeout(resolve, delay));
	spawnSidecar();
	const healthy = await waitUntilHealthy();
	if (healthy && win && !win.isDestroyed()) {
		win.webContents.reload();
	}
}

/** Poll /api/config until the sidecar answers, or the budget runs out. */
async function waitUntilHealthy(): Promise<boolean> {
	const deadline = Date.now() + HEALTH_TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1500) });
			if (res.ok) {
				sidecarRestartAttempts = 0;
				console.log(`[player] sidecar healthy at ${HEALTH_URL}`);
				return true;
			}
		} catch {
			// not up yet — keep polling
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	console.error(`[player] sidecar unhealthy after ${HEALTH_TIMEOUT_MS}ms (${HEALTH_URL})`);
	return false;
}

// --- Push-to-talk ----------------------------------------------------------------

/**
 * globalShortcut only sees presses — the hotkey toggles listening. Held-key
 * semantics would need a native hook; toggle is the robust trade-off for the
 * first blind playtest.
 */
function togglePtt(): void {
	pttActive = !pttActive;
	const action = pttActive ? "start" : "stop";
	console.log(`[player] ptt ${action} (${PTT_ACCELERATOR})`);
	if (win && !win.isDestroyed()) {
		win.webContents.send("skyguide:ptt", action);
	}
}

// --- Skyrim window auto-source ------------------------------------------------------

async function pickSkyrimSource(): Promise<Electron.DesktopCapturerSource | undefined> {
	const sources = await desktopCapturer.getSources({
		types: ["window", "screen"],
		thumbnailSize: { width: 0, height: 0 },
	});
	const skyrim = sources.find((source) => SKYRIM_SOURCE_RE.test(source.name));
	if (skyrim) {
		console.log(`[player] capture source: "${skyrim.name}"`);
		return skyrim;
	}
	const fallback = sources[0];
	console.warn(`[player] no /skyrim/i source — falling back to "${fallback?.name ?? "none"}"`);
	return fallback;
}

// --- Window / tray --------------------------------------------------------------------

async function createWindow(): Promise<void> {
	win = new BrowserWindow({
		width: 1024,
		height: 768,
		show: false, // hidden player runtime; tray menu reveals it for debugging
		title: "SkyGuide Player",
		icon: appIconPath(),
		webPreferences: {
			preload: join(import.meta.dirname, "preload.mjs"),
			sandbox: false, // ESM preload
			autoplayPolicy: "no-user-gesture-required",
		},
	});

	const devUrl = process.env["VITE_DEV_SERVER_URL"];
	const base = devUrl
		? devUrl.replace(/\/+$/, "")
		: `http://127.0.0.1:${PORT}`;

	// WSLg makes GUI + audio + mic work from WSL2 (PulseAudioRDPSink/Source),
	// but desktopCapturer only enumerates WSL windows — the Skyrim window is
	// invisible from here, so ambient clips and /skyrim/i capture can never
	// work. Say it loudly instead of falling back silently.
	if (process.platform === "linux" && process.env.WSL_DISTRO_NAME) {
		console.warn(
			`[player] WSL detected (${process.env.WSL_DISTRO_NAME}) — desktopCapturer cannot see Windows windows; ` +
				"run `pnpm dev:player` from Windows (PowerShell) for Skyrim capture + native audio",
		);
	}

	// Pass the actual PTT key so the renderer displays the truth (it cannot
	// read main-process env).
	const url = `${base}/player?ptt=${encodeURIComponent(PTT_ACCELERATOR)}`;
	await win.loadURL(url);
	console.log(`[player] renderer loaded: ${url}`);

	win.on("closed", () => {
		win = null;
	});
}

function createTray(): void {
	// Real branding when the icon file is around (dev: build/, packaged:
	// resources/), embedded square as fallback.
	let icon = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_BASE64}`);
	const fileIcon = nativeImage.createFromPath(appIconPath());
	if (!fileIcon.isEmpty()) {
		icon = fileIcon.resize({ width: 16, height: 16 });
	}
	tray = new Tray(icon);
	tray.setToolTip("SkyGuide Player");
	const menu: MenuItemConstructorOptions[] = [
		{ label: `SkyGuide — port ${PORT}`, enabled: false },
		{ type: "separator" },
		{
			label: "Montrer la fenêtre",
			click: () => {
				win?.show();
			},
		},
		{
			label: "Masquer la fenêtre",
			click: () => {
				win?.hide();
			},
		},
		{ type: "separator" },
		{
			label: "Démarrage automatique",
			type: "checkbox",
			checked: readSettings().autostart,
			click: (item) => {
				const autostart = item.checked === true;
				applyAutostart(autostart);
				writeSettings({ autostart });
			},
		},
		{ type: "separator" },
		{
			label: "Quitter",
			click: () => {
				app.quit();
			},
		},
	];
	tray.setContextMenu(Menu.buildFromTemplate(menu));
}

function applyAutostart(autostart: boolean): void {
	if (!app.isPackaged) return; // login items only make sense for the installed app
	app.setLoginItemSettings({
		openAtLogin: autostart,
		path: process.execPath,
		args: ["--hidden"],
	});
}

// --- Lifecycle ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
	app.quit();
} else {
	app.on("second-instance", () => {
		win?.show();
	});

	void app.whenReady().then(async () => {
		// Intercept the renderer's getDisplayMedia call (capture.ts) and
		// auto-pick the Skyrim window — no picker UI for a blind player.
		session.defaultSession.setDisplayMediaRequestHandler(
			(_request, callback) => {
				void pickSkyrimSource().then((source) => {
					if (source) {
						callback({ video: source });
					}
				});
			},
			{ useSystemPicker: false },
		);

		if (sidecarEntry()) {
			spawnSidecar();
		}
		await waitUntilHealthy();

		await createWindow();
		createTray();
		globalShortcut.register(PTT_ACCELERATOR, togglePtt);
		console.log(
			`[player] ready — ptt on ${PTT_ACCELERATOR}, autostart ${readSettings().autostart}`,
		);
	});

	app.on("before-quit", () => {
		quitting = true;
		globalShortcut.unregisterAll();
		if (sidecar) {
			console.log("[player] stopping sidecar");
			sidecar.kill();
			sidecar = null;
		}
		tray?.destroy();
		tray = null;
	});

	// Tray application: closing/destroying the window must not exit the app.
	// Quit lives in the tray menu.
	app.on("window-all-closed", () => {
		// no-op
	});
}
