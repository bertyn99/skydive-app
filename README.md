<p align="center">
  <img src="docs/branding/hero.jpg" alt="The Elder Scrolls V — SKYGUIDE" width="100%">
</p>

# SkyGuide — Skyrim Accessibility Assistant

**SkyGuide** is a real-time accessibility assistant for blind and visually
impaired *Skyrim* players. A Skyrim Platform plugin streams game state, a
capture source streams short video clips, and a two-tier AI pipeline turns
them into spoken guidance — a **Gate** decides *whether* the player should
hear something right now, then a **Composer** phrases the observation in
French. Every broadcast carries provenance (which engine spoke, how long it
took).

One app, two surfaces:

- **Web dashboard** (`/`) — the operator/dev console: live session,
  provenance chips, engine pickers, eval matrix
- **Electron player runtime** (`pnpm dev:player` / `pnpm package:player`) —
  the blind player's shell: hidden window, tray + autostart, global
  push-to-talk (F9), capture auto-targeting the Skyrim window, direct audio
  out

## How it works

1. **Browser** captures the screen via `getDisplayMedia()` and encodes short video
   clips using [MediaBunny](https://mediabunny.dev/) (H.264 / MP4, in-browser via WebCodecs).
2. Clips are sent to the **Nitro server** over WebSocket.
3. The server forwards each clip to **Gemini 3.1 Flash Lite** for scene description.
4. The description is broadcast back to the browser and spoken aloud via **Mistral TTS**.

```
Capture source                  Server (Nitro, :3000)
┌─────────────────┐      ┌────────────────────────────┐
│ getDisplayMedia  │      │ Gate (shouldSpeak? engine)  │
│ → MediaBunny    │─WS──▶│ → Composer (French prose)   │
│   (MP4 encode)  │      │ → voice module TTS chain    │
│                 │◀─WS──│   (Mistral/ElevenLabs/Piper)│
│ audio queue     │      │   provenance on everything  │
└─────────────────┘      └────────────────────────────┘
```

## Prerequisites

- **Node.js** 23.6+ (native TypeScript execution for scripts)
- A **Chromium-based browser** (Chrome, Edge, Arc, Brave) — WebCodecs is required
- A **Google AI** API key for Gemini (`GOOGLE_GENERATIVE_AI_API_KEY`)
- A **Mistral** API key for TTS (`MISTRAL_API_KEY`)

## Getting started

```bash
npm install
npm run dev
```

### Sim-session dev material (lets-plays)

The Sim mode runs the whole pipeline against a video file instead of the live
game. Download source videos into the gitignored `media/letsplays/` folder —
pure npm, no external tools (`@distube/ytdl-core` downloads, mediabunny slices):

```bash
pnpm fetch:letsplays                     # curated Skyrim playthroughs
pnpm fetch:letsplays --list              # see what's in the curated list
pnpm fetch:letsplays --search "query"    # search YouTube (top 3)
pnpm fetch:letsplays --id <url|id> --section 12:00-14:00   # grab a slice
```

Downloads are large (multi-hour videos), which is why `media/` is gitignored —
the script is the reproducible path on a fresh machine. Quality defaults to
1080p: YouTube serves 1080p as separate video/audio streams, which the script
merges in-process with mediabunny (no ffmpeg).

Open the app in Chrome, click **Start Capture**, and select the game window to share.

## Project structure

```
src/                        # Browser (React + Zustand)
  utils/capture.ts          # getDisplayMedia + MediaBunny recording
  stores/useAppStore.ts     # State management + capture loop
  components/               # UI panels (ScreenViewer, ConfigPanel, DebugLogs, …)

server/                     # Nitro server
  routes/_ws.ts             # WebSocket handler
  utils/engine.ts           # Clip processing + broadcast
  utils/gemini.ts           # Gemini AI integration
  utils/mistral-tts.ts      # Text-to-speech
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Capture interval | 3 000 ms | Duration of each video clip (1–10 s) |
| System prompt | Built-in French prompt | Override via the UI textarea |

## Tech stack

- **React 19** + **Zustand** — frontend
- **Vite 8** — dev server & bundler
- **Nitro** — backend (WebSocket + API)
- **MediaBunny** — in-browser video encoding (replaces FFmpeg)
- **Vercel AI SDK** + **Gemini** — scene description
- **Mistral TTS** — text-to-speech

## License

Private.
