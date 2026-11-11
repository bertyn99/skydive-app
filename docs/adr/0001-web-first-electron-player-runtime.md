# Web-first dashboard, Electron shell for the player runtime

SkyGuide has two users with opposite needs: the blind player (needs zero visible UI, zero
config, always-on capture/audio) and the operator (needs live telemetry and controls).
We decided to keep the app a single web app — it is the operator console and the dev/test
harness (sim sessions, evals) — and to add, when the first real blind playtest is scheduled,
an Electron player-runtime shell that embeds the existing Nitro server as a sidecar on
port 3000 and runs the same store logic hidden.

Why: the browser cannot serve the blind player autonomously — the `getDisplayMedia` picker
is vision-required and cannot be programmatically bypassed, audio lives in a tab, and
process lifecycle needs manual steps. Electron adds exactly those four capabilities
(desktopCapturer auto-source by window title, tray + autostart, global push-to-talk
hotkey, direct audio out) while the SKSE plugin needs zero changes — its config already
targets `http://localhost:3000` on the player's machine, so the shell just packages what
is already local. The shell builds through `vite-plugin-electron` so the existing
vite.config (Nitro + React Compiler + rolldown) stays untouched.

## Considered options

- **Web-only**: rejected — the screen-share picker makes the player flow impossible
  without sighted help.
- **Tauri**: rejected for now — the Node backend still ships as a sidecar, so it adds a
  Rust toolchain tax for no capability gain; the UI is plain web running fine in
  Chromium. Revisit only if bundle size or memory becomes a real complaint.
- **Split into two apps**: rejected — one app, two surfaces; the operator dashboard is
  the same session over WS/LAN.

## Consequences

- Stages 2–6 stay web-only; the shell is Stage 7, triggered by the first blind playtest,
  not by enthusiasm.
- The store/session logic must stay DOM-coupled-free so the hidden renderer can run it.
- Windows is the only first-class packaging target (Skyrim is Windows-only).
