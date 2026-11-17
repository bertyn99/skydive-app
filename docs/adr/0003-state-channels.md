# ADR 0003: State channels — fast lane (protocol-v1) vs context lane (state.json dump)

Date: 2026-11-16
Status: Accepted
Related: plan W1 (Skyrim Access port), ADR-0002 (web-first Electron player runtime)

## Context

The plugin delivers game state to the app over two paths that were implicitly
sharing one job:

1. **HTTP POST `/api/game-state`** (500 ms, priority-arbitrated) — consumed by
   `updateGameState` → **reflex rules** (0 ms canned callouts) and broadcast to
   the dashboard over the WebSocket.
2. **`state.json` file dump** (`Data/Platform/SkyGuide/state.json`, written on
   every tick, never suppressed) — consumed by `SkyrimFileConnector` →
   `parseSkyrimState` → **Gate/Composer mod context**, read once per processed
   clip (~6 s cadence, engine running only).

The Skyrim Access port added latency-critical fields (stuck detection,
navigation status, menu/console flags) and rich perception data (world
scanner). Putting both kinds on either channel alone breaks: the dump is read
too rarely for reflexes (up to ~6 s late, never when capture is stopped), and
the POST would bloat if it carried the full object arrays.

## Decision

Two channels, explicit contracts:

- **Fast lane = protocol-v1 POST.** Carries small, latency-critical scalars.
  Additive extension fields on `GameStateData` (`protocolVersion` stays `1`,
  the route validates only the envelope):
  `headingAngleZ`, `isStuck`, `navigation.status`, `ui.menuOpen`, `ui.consoleOpen`,
  `menu` (ItemMenu focus: `event` only when the GFx diff fired).
  Consumers: reflex rules, speech arbiter (W2, including the `menu` channel),
  radar trigger, autowalk (W6), menu dictation (`menu-speech.ts`).
- **Context lane = state.json dump (schema v2).** Carries the parallel arrays
  (`npcs.*`, `world.objects.*`) that feed the Gate/Composer prompt.
  New in v2: `dump.version` (int, `2`), `dump.timestamp` (float, ms epoch),
  and the `world.objects.*` family
  (`name`, `category`, `flags`, `compass`, `distance_m`, `distance_u`,
  `form_id`, `bearing_deg`, `lock_level`, `dz`, `count`).

Cross-cutting rules:

- **Freshness**: the parser drops any dump whose `dump.timestamp` is older
  than ~10 s — a quit game must not whisper stale state into Gemini. Dumps
  without a timestamp (pre-v2) are never dropped.
- **Skew semantics**: absent field/channel = feature off (the parser's
  tolerant getters already return null/[]). Old plugins keep working against
  a new app and vice versa. *Semantic* changes to existing fields
  (e.g. `player.is_stuck` going live in W3) ship plugin+app together.
- **Contract fixtures**: `test/fixtures/dump-v2.json` is committed IDENTICAL
  to both repos (`skyguide-skse/test/fixtures/dump-v2.json`); both test suites
  assert against it — the contract in executable form. `dump.timestamp` is
  volatile and deliberately excluded from the fixture.
- **Denylist, not boolean**: `ui.menuOpen` means "gameplay-blocking menu"
  (skymp5-client's `browserService.badMenus` set, plus Dialogue/MessageBox/
  LevelUp/Sleep/Favorites/Quantity/Magic/Training). HUD/Fader/Cursor/Mist are
  always-on and never count — a naive "any menu" check would mute SkyGuide
  forever.
- **No `intList` channel yet** (decision D4): formIds fit exactly in JSON
  numbers (< 2^53) and travel in `floatList`. Add an `intList` channel only
  when a real consumer appears.
- **Compass math lives plugin-side** (`mod-context.ts`): the dump carries
  absolute `bearing_deg` AND the sector string; the app never re-derives
  sectors. App-side templates lowercase the sector for speech.
- **Menu speech templates live app-side** (`menu-speech.ts`). The plugin
  never synthesizes audio. `inventory.*` parallel arrays on the dump are
  additive (omitted when empty so the dump-v2 fixture key set stays stable).

## Consequences

- Reflexes see new state within one 500 ms tick, even with capture stopped.
- The radar (W5) reads `world.objects.*` from the dump — fresh enough for its
  2500 ms cadence since the dump is written every tick and never suppressed.
- The plugin keeps a single writer for both channels; the app's parser stays
  the single schema authority on the reading side.
- `player.is_stuck` in the dump remains `0` until W3 lands the real detector;
  the protocol field `isStuck` follows the same schedule (always emitted,
  `false` until then).

## Non-goals

- No WebSocket delivery of the dump (the CEF bridge scaffold stays disabled).
- No per-object delta protocol; the dump is a full snapshot by design.
