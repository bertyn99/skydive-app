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

## Notes

- React Compiler is on: no useMemo/useCallback/React.memo.
- No `any`, no `@ts-ignore`; strict TS; `pnpm build` + `pnpm lint` must stay green per stage.
- Commit after each stage. Linear project: Skyguide (YGG team) — tickets can mirror stages.
