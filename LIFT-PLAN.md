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

## Stage 2 — Simulation session (Sources)

- [ ] `Source` abstraction in store: `screen` (existing getDisplayMedia) | `video-file`
      (file picker → object URL → `video.captureStream()` into the existing clip pipeline).
- [ ] Mode switcher LIVE/SIM in the command bar (per GLOSSARY: Live session / Simulation session).
- [ ] Video-file controls in the stage: play/pause, seek, loop, time readout.
- [ ] Engine/server: verify clip path works without mod context (should already — connector is optional).

## Stage 3 — Situations + Eval runner

- [ ] `situations/` dir: fixtures = webm clip + `situation.json` (id, description, mod context?,
      expectation: speak|silence, relevanceBand?, expectedActions?, notes).
- [ ] Eval runner: server route or script — runs each Situation through the real pipeline
      (fresh observation history per Situation), deterministic checks (spoke/silence, French,
      ≤2 sentences, relevance band, action types) + human verdict slot.
- [ ] Evals panel in dashboard: run suite, per-Situation result list, drift view across runs
      (results saved to `situations/results/*.json`).
- [ ] Silence discipline fixture type: same clip fed twice, expect SILENCE on the second pass.

## Stage 4 — Engine seams + provenance

- [ ] TTS engine seam: elevenlabs | mistral | piper (local, fr_FR, ~100ms).
- [ ] STT engine seam: elevenlabs | whisper-local (faster-whisper/whisper.cpp server, fr).
- [ ] Provenance chips on every observation in telemetry (`GATE · clef-flash · 45ms · 0.92`).

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

## Notes

- React Compiler is on: no useMemo/useCallback/React.memo.
- No `any`, no `@ts-ignore`; strict TS; `pnpm build` + `pnpm lint` must stay green per stage.
- Commit after each stage. Linear project: Skyguide (YGG team) — tickets can mirror stages.
