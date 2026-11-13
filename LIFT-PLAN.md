# SkyGuide Lift Plan

Goal: full lift of the operator dashboard — mission-control precision-instrument design — plus
two capability stages that turn the dashboard into the dev/test harness for the blind-player
experience without launching Skyrim (see GLOSSARY.md for vocabulary).

## Stage 1 — Mission-control design lift (design only, zero behavior change)

- [ ] Fonts: self-hosted variable fonts (mono-forward identity for data/labels, character sans
      for the wordmark). No runtime Google Fonts dependency.
- [ ] Design tokens in `src/index.css` (palette: cool slate-charcoal, single teal-cyan accent,
      semantic success/warn/danger, spacing scale, z-index scale, tabular-nums for data).
- [ ] App shell: top command bar (wordmark, session status cluster), video stage with HUD
      overlay (REC, interval), right control rail, bottom telemetry row.
- [ ] Panels: ScreenViewer (stage + composed empty state), ConfigPanel (grouped sections),
      DebugLogs (observation + audio queue + log stream, no inline styles),
      GameStatePanel (text badges instead of emoji, ticked bars), StatusBar (mono cells).
- [ ] States: hover/active/focus-visible everywhere, disabled states, empty states.
- [ ] index.html: real title + meta.

## Stage 2 — Simulation session (Sources) — ✅ shipped

- [x] `Source` abstraction in store: `screen` (existing getDisplayMedia) | `video-file`
      (file picker → object URL → `video.captureStream()` into the existing clip pipeline).
- [x] Mode switcher LIVE/SIM in the command bar (per GLOSSARY: Live session / Simulation session).
- [x] Video-file controls in the stage: play/pause, seek, loop, time readout.
- [x] Engine/server: clip path verified mod-context-optional (runtime test with a real
      lets-play file remains a manual step — YGG-231 note).

## Stage 3 — Situations + Eval runner — ✅ shipped

- [x] `situations/` dir: fixtures = clip + `situation.json` (id, description, mod context?,
      expectation: speak|silence, relevanceBand?, maxSentences?, expectedActions?, notes,
      repeat? for silence discipline). `scripts/slice-clip.ts` cuts fixture clips from big files.
- [x] Eval runner: `POST /api/evals/run` (async, one run at a time) — runs each Situation
      through the real pipeline (`describeVideo`, fresh observation history per Situation),
      deterministic checks (spoke/silence via pipeline semantics, French lexicon, ≤2 sentences,
      relevance band, action types) + human verdict slot. 120s timeout per model call.
- [x] Evals panel in dashboard (TanStack Vue Query): run suite, per-Situation result cards
      (checks, observations, latency), human verdict buttons, drift view across runs
      (results persisted to `situations/results/*.json`).
- [x] Silence discipline fixture type: `repeat: { expectation }` — same clip fed twice,
      history retained, expect SILENCE on the second pass (verified live).

## Stage 4 — Engine seams + provenance — ✅ shipped

- [x] TTS engine seam (`server/utils/tts.ts`): elevenlabs | mistral | piper-local
      (spawn, fr_FR voice via `PIPER_VOICE`, WAV out). Fallback chain across all
      engines with provenance naming the engine that actually produced audio
      (`fallbackFrom` when the requested one failed). Verified live: mock piper
      54ms; forced failures cascade correctly (piper→elevenlabs→mistral).
- [x] STT engine seam (`server/utils/stt.ts`): elevenlabs | whisper-local
      (whisper.cpp `/inference` client, `WHISPER_STT_URL`, fr). Verified live:
      mock whisper 28ms; unreachable server falls back to elevenlabs.
- [x] Provenance chips: `GATE · model · latency · rel` on every description
      broadcast, `TTS · engine · latency · cached` on audio, `stt` provenance on
      voice questions — rendered in the telemetry panel; engine pickers (TTS/STT)
      in the session panel, synced over status broadcasts.
- [x] Fixes: removed the dead game-state Gemini path (called non-existent
      `describeFrame`/`captureScreen` since the browser took over capture —
      would have crashed on the first critical mod event); high/critical game
      state now sets an urgency flag that bypasses the ambient clip cooldown.
      ElevenLabs voice is env-overridable (`ELEVENLABS_TTS_VOICE_ID`) — current
      key gets 402 on all TTS (free plan), Mistral key is invalid (401): both
      cloud voice engines are down, previously silent, now loud in provenance.

## Stage 5 — Decision-model Gate (System 1)

- [ ] Gate module: `experimental_decide()` per clip — shouldSpeak (boolean), isNew (boolean),
      relevance (score: silence/minor/useful/critical), category (choice: danger/interaction/
      navigation/change/question). State = mod context JSON + observation history + clip frames.
- [ ] Escalation policy: calibrated confidence thresholds decide speak-now / compose / escalate
      to cloud; configurable.
- [ ] Reflex rules on mod context (0ms callouts bypass the Gate for true emergencies).
- [ ] Eval runner gains an engines matrix: same Situations × {gemini-gate, clef-flash-gate,
      rules} → accuracy + calibration report. The Gate ships only when evals say it beats or
      matches the current Gemini path.

## Stage 6 — Local Composer + full-local mode (System 2)

- [ ] Local VLM composer via `@ai-sdk/openai-compatible` (Ollama/LM Studio, e.g. Qwen2.5-VL):
      structured facts → short French observation; questions may stay cloud.
- [ ] Engine picker UI (gate/composer/tts/stt × cloud/local) + offline profile.
- [ ] Local decision model as Labs option (Clef-flash 9B open weights need their custom
      schema head — bleeding edge; hosted Workers AI Clef-flash is the pragmatic default).

## Stage 7 — Player runtime (Electron shell) — triggered by first blind playtest

See ADR-0001. One app, two surfaces: web dashboard = operator/dev; Electron shell =
blind player (hidden UI, tray, autostart, global push-to-talk, direct audio out,
desktopCapturer auto-source by window title). Built with `vite-plugin-electron` on the
existing vite config; Nitro server runs as sidecar on port 3000 (SKSE plugin unchanged).

- [ ] Electron main: sidecar lifecycle (start/health-check/restart), tray + autostart
- [ ] Hidden renderer running the shared session core (store/voice/ws logic, DOM-free)
- [ ] desktopCapturer source matching /skyrim/i — replaces getDisplayMedia picker
- [ ] Global push-to-talk hotkey (hex pattern) + direct audio output
- [ ] electron-builder NSIS installer (Windows-only target)

## Notes

- React Compiler is on: no useMemo/useCallback/React.memo.
- No `any`, no `@ts-ignore`; strict TS; `pnpm build` + `pnpm lint` must stay green per stage.
- Commit after each stage. Linear project: Skyguide (YGG team) — tickets can mirror stages.
