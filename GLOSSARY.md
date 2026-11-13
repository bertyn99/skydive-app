# SkyGuide

Real-time decision assistant for blind and vision-impaired Skyrim players: it watches the game (video + mod telemetry), decides when speaking adds value, and speaks short actionable observations in French. This repo also contains the operator dashboard used to develop and test the assistant without launching the game.

## Language

**Observation**:
A short, actionable statement spoken to the player. The only output that matters; silence is the default.
_Avoid_: description, caption, message

**SILENCE**:
The deliberate decision to output nothing because the information is already known or not actionable.
_Avoid_: skip, mute, empty response

**Relevance**:
A 0–10 score attached to an Observation; below 4 forces SILENCE.
_Avoid_: score, priority (reserved for game-state priority)

**Live session**:
A run against the real game: screen capture plus mod telemetry from the SKSE plugin.
_Avoid_: production mode, real mode

**Simulation session** (sim):
A run against a video Source instead of the game, so the full pipeline (clips → analysis → TTS → voice) can be exercised without launching Skyrim.
_Avoid_: test mode, replay mode, YouTube mode

**Source**:
What feeds the pipeline with video: `screen` (display capture) or `video-file` (local lets-play file, deterministic and seekable).
_Avoid_: input, stream

**Mod context**:
Real-time game state pushed by the SKSE plugin (player vitals, enemies, combat). Absent in a Simulation session.
_Avoid_: game state (reserved for the specific payload), telemetry

**Situation**:
A test fixture: a media clip plus expected assistant behavior (speak/silence, content, relevance band). The unit of static evaluation.
_Avoid_: test case, scenario, fixture alone

**Eval run**:
Executing a set of Situations through the real pipeline and scoring the results (deterministic checks + human verdict) to detect regressions across prompt or model changes.
_Avoid_: test suite run, CI

**Seam**:
The engine dispatch layer for voice I/O: TTS (`elevenlabs | mistral | piper-local`) and STT (`elevenlabs | whisper-local`). Callers ask for an engine by id; the seam dispatches, measures latency, and falls back through the remaining engines on failure. Configured per engine kind from the dashboard or `TTS_ENGINE`/`STT_ENGINE` env.
_Avoid_: provider switch, backend, adapter (unqualified)

**Provenance**:
The chip attached to every pipeline output naming what produced it: `GATE · model · latency · relevance` for observations, `TTS · engine · latency` for audio (plus `cached` / `↯ fallback-from`). Always names the engine that actually produced the output, not the one that was asked.
_Avoid_: metadata, telemetry fields (telemetry is reserved for mod context)
_Avoid_: benchmark, CI test

**Reflex**:
Deterministic rules on mod context that fire with no AI call (health crash, combat start, enemy in melee range). Fastest tier; cannot be talked out of by a model.
_Avoid_: hard rules, triggers

**Gate**:
The per-clip decision call that answers typed questions (should speak, is new, relevance, category) with calibrated confidence, using a decision model. Decides speak vs silence vs escalate.
_Avoid_: filter, router

**Composer**:
The step that writes the French Observation once the Gate has decided to speak, or answers a player question. The only tier that generates text.
_Avoid_: generator, writer, LLM call

**Engine**:
A swappable implementation for one slot of the pipeline (gate, composer, TTS, STT), each deployable cloud or local.
_Avoid_: provider, backend, model (a model powers an Engine)

**Escalation**:
The confidence-threshold policy that promotes a decision from Gate to Composer (or to cloud from local) when calibrated confidence is below threshold.
_Avoid_: fallback, retry
