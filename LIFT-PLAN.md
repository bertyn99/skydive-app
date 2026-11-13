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

## Post-Stage 4 — Dashboard IA (multi-page + responsive)

- [x] Console split into routed pages behind a dashboard shell (`UDashboardGroup`
      + collapsible `UDashboardSidebar`): `/` Session (stage, telemetry, controls,
      mod context — fixed 2-column instrument grid on lg+, single-column scroll
      below) and `/evals` Evals (full-width page: fixture cards grid, run results
      in 2 columns, drift table). WebSocket session lives in the shell, so the
      link and in-flight eval runs survive navigation.
- [x] Fixes the overlap at ~1240px where the evals panel bled behind the stage
      (single-page grid had a fixed row map for 5 panels); each page now owns
      its own overflow, so panels cannot overlap at any width.

## Stage 5 — Decision-model Gate (System 1) — ✅ shipped (gemini + rules + local adapter)

- [x] Gate module (`server/utils/gate.ts`): `experimental_decide()` per clip —
      shouldSpeak, isNew, relevance (silence/minor/useful/critical), category
      (danger/interaction/navigation/change/question), confidence 0-1, and an
      ≤8-word summary as composer handoff. State = mod context + observation
      history + clip.
- [x] Gate engines: `gemini` (decision-only call, no composer), `local`
      (YGG-248 adapter: any self-hosted decision model behind an
      OpenAI-compatible endpoint — Ollama/LM Studio/vLLM via
      GATE_LOCAL_BASE_URL/GATE_LOCAL_MODEL; unreachable = explicit
      unavailable), `rules` (clip-blind heuristic on mod context — the
      matrix baseline that proves vision is needed).
- [x] Escalation policy: `applyGatePolicy` — speak requires shouldSpeak +
      isNew + relevance class ≥ configured floor (default useful) +
      confidence ≥ configured floor (default 0.5). Gated pipeline in the
      engine loop: gate decides, cloud composer runs only on speak
      (provenance chip carries gate + composer). Configurable from the
      Session panel (pipeline + gate engine pickers).
- [x] Reflex rules (`server/utils/reflex.ts`): canned 0ms callouts from mod
      context — death, critical health, melee contact — bypassing the Gate
      entirely, with per-rule anti-spam cooldown. Provenance tier `reflex`.
- [x] Eval matrix (Stage 5 report): `POST /api/evals/run` takes an `engines`
      array; the runner scores each Situation × engine (fused vs gate
      decisions) with decision-tier checks (spoken, relevanceClass, novelty)
      and produces per-engine scorecards — accuracy, speak recall, silence
      precision, avg latency, confidence calibration (correct vs incorrect).
      Availability probes turn a missing local model into an explicit
      "unavailable" scorecard instead of failed passes. The dashboard shows
      the matrix table (situations × engines) + scorecards; the Gate ships
      only if evals say it beats or matches the fused baseline.
- [ ] Clef-flash weights behind the custom schema head remain bleeding-edge;
      until hosted, the `local` adapter accepts any vision-capable
      OpenAI-compatible model.

## Stage 6 — Local Composer + full-local mode (System 2) — ✅ shipped (cloud/local picker + offline profile)

- [x] Composer module (`server/composer/`) — architecture mirrors
      `server/voice/`: public API (`index.ts`), `config.ts` (env knobs +
      compose contract + prompts), `providers/` (one file per engine),
      `service.ts` (registry + `COMPOSER_CHAIN` fallback chain with
      provenance: engine, modelId, fallbackFrom, latency).
- [x] Composer engines: `gemini-cloud` (compose-only Gemini call — the
      decision was made upstream, plus operator prompt override support)
      and `local` (self-hosted vision model behind an OpenAI-compatible
      endpoint — Ollama/LM Studio/vLLM, `COMPOSER_LOCAL_BASE_URL/MODEL`,
      e.g. Qwen2.5-VL). Availability probes feed the dashboard.
- [x] Gated pipeline composes through the seam: gate summary becomes the
      composer's intention; composer veto still records a history tombstone;
      all-engines-failed records a tombstone + broadcast SILENCE. Provenance
      chip carries gate + composer engine/model/fallback/latency, showing the
      effective relevance (what reached the player).
- [x] Engine picker UI: composer engine select in the Session panel (gated
      pipelines), availability + setup hints from the composer registry;
      **offline profile** button flips every seam atomically (pipeline gated,
      gate local, composer local, tts piper-local, stt whisper-local) with a
      cloud profile restoring the baseline; derived profile badge
      (offline/cloud/custom).
- [x] Questions still route through the fused cloud path in this stage
      (they need a model that can answer, not just compose); offline question
      answering lands with the Electron runtime work.
- [ ] Clef-flash as the hosted decision model stays tracked on YGG-237.

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
