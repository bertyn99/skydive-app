# SkyGuide — Skyrim Accessibility Assistant

A real-time screen reader for blind and visually impaired gamers. The app captures
the game screen, sends the video to an AI model (Gemini) that describes the scene,
and reads the description aloud via text-to-speech.

## How it works

1. **Browser** captures the screen via `getDisplayMedia()` and encodes short video
   clips using [MediaBunny](https://mediabunny.dev/) (H.264 / MP4, in-browser via WebCodecs).
2. Clips are sent to the **Nitro server** over WebSocket.
3. The server forwards each clip to **Gemini 3.1 Flash Lite** for scene description.
4. The description is broadcast back to the browser and spoken aloud via **Mistral TTS**.

```
Browser                         Server
┌─────────────────┐      ┌──────────────────────┐
│ getDisplayMedia  │      │ Nitro WebSocket      │
│ → MediaBunny    │─WS──▶│ → Gemini (describe)  │
│   (MP4 encode)  │      │ → Mistral TTS        │
│                 │◀─WS──│ → broadcast desc/audio│
│ <video> preview │      └──────────────────────┘
└─────────────────┘
```

## Prerequisites

- **Node.js** 20+
- A **Chromium-based browser** (Chrome, Edge, Arc, Brave) — WebCodecs is required
- A **Google AI** API key for Gemini (`GOOGLE_GENERATIVE_AI_API_KEY`)
- A **Mistral** API key for TTS (`MISTRAL_API_KEY`)

## Getting started

```bash
npm install
npm run dev
```

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
