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
_Avoid_: benchmark, CI test
