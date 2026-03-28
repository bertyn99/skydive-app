# Plan: skydive-app Modifications

> Changes to the existing skydive-app to receive game state from the SkyGuide Skyrim plugin.
> Momus-reviewed v2 — all blocking issues resolved.

---

## Context

- **Parent project**: SkyGuide (global plan at `../../.sisyphus/plans/skyguide-project.md`)
- **Existing stack**: React 19 + Nitro 3 + Gemini 2.0 Flash + Mistral TTS
- **New features**: REST endpoint for game state, engine integration, dashboard panel

---

## Tasks

### Phase 0: Protocol Types

**Task 0.3: Create protocol types** ✅ DONE
- Create `server/utils/protocol.ts` with TypeScript interfaces:
  ```typescript
  export type PriorityLevel = "critical" | "high" | "medium" | "low" | "suppressed";
  export type GameEventType = "tick" | "combatState" | "deathStart" | "deathEnd" | "hit" | "animation";

  export interface Position {
    x: number;
    y: number;
    z: number;
  }

  export interface PlayerState {
    health: number;
    maxHealth: number;
    magicka: number;
    stamina: number;
    level: number;
    position: Position;
    isSneaking: boolean;
    isDead: boolean;
  }

  export interface EnemyState {
    formId: number;
    name: string;
    distance: number;
    health: number;
    level: number;
    animation: string;
  }

  export interface GameStateData {
    player: PlayerState;
    combatState: number;
    enemies: EnemyState[];
    playerAnimation: string;
    eventType: GameEventType;
  }

  export interface GameStatePayload {
    protocolVersion: number;
    priority: PriorityLevel;
    source: string;
    data: GameStateData;
    timestamp: number;
  }

  export interface GameStateResponse {
    status: "ok" | "error";
    geminiTriggered?: boolean;
    error?: string;
    serverTimestamp: number;
  }
  ```
- Export all types
- **QA**: Run `pnpm build` — TypeScript compiles with zero errors. Verify types are exported by checking `npx tsc --noEmit` succeeds.

---

### Phase 2: REST Endpoint

**Task 2.2: Create POST /api/game-state endpoint** ✅ DONE
- Create `server/api/game-state.post.ts`:
  ```typescript
  import { defineEventHandler, readBody, createError } from "h3";
  import type { GameStatePayload, GameStateResponse } from "../utils/protocol";
  import { updateGameState } from "../utils/engine";

  export default defineEventHandler(async (event) => {
    const body = await readBody<GameStatePayload>(event);

    // Validate protocol version
    if (body.protocolVersion !== 1) {
      throw createError({
        statusCode: 400,
        message: "Unsupported protocol version"
      });
    }

    // Validate required fields
    if (!body.priority || !body.data || !body.timestamp) {
      throw createError({
        statusCode: 400,
        message: "Missing required fields"
      });
    }

    // Store in engine
    const geminiTriggered = updateGameState(body);

    const response: GameStateResponse = {
      status: "ok",
      geminiTriggered,
      serverTimestamp: Date.now()
    };

    return response;
  });
  ```
- **QA**:
  1. Run `pnpm dev` and verify server starts without errors
  2. `curl -X POST http://localhost:3000/api/game-state -H "Content-Type: application/json" -d '{"protocolVersion":1,"priority":"low","source":"test","data":{"player":{"health":100,"maxHealth":100,"magicka":100,"stamina":100,"level":10,"position":{"x":0,"y":0,"z":0},"isSneaking":false,"isDead":false},"combatState":0,"enemies":[],"playerAnimation":"Idle","eventType":"tick"},"timestamp":1234567890}'`
  3. Expected: HTTP 200 with `{"status":"ok","geminiTriggered":false,"serverTimestamp":...}`
  4. `curl -X POST http://localhost:3000/api/game-state -H "Content-Type: application/json" -d '{"protocolVersion":99}'`
  5. Expected: HTTP 400 with error message

---

### Phase 3: Engine + Gemini Integration

**Task 3.2: Implement Gemini rate limiting and game state broadcasting** ✅ DONE
- Modify `server/utils/engine.ts`:
  - Add to `EngineState` interface:
    ```typescript
    latestGameState: GameStatePayload | null;
    lastGeminiCall: number;
    geminiProcessing: boolean;
    ```
  - Initialize new fields:
    ```typescript
    latestGameState: null,
    lastGeminiCall: 0,
    geminiProcessing: false,
    ```
  - Add `updateGameState(payload: GameStatePayload): boolean`:
    ```typescript
    export function updateGameState(payload: GameStatePayload): boolean {
      // 1. Store latest game state
      state.latestGameState = payload;

      // 2. Broadcast to all WebSocket clients (using existing broadcast function)
      broadcast({
        type: "gameState",
        data: payload.data,
        priority: payload.priority,
        timestamp: payload.timestamp
      });

      // 3. Determine if Gemini should be triggered
      const now = Date.now();
      const timeSinceLastCall = now - state.lastGeminiCall;
      const MIN_CALL_INTERVAL = 5000; // 5 seconds between Gemini calls

      // Rate limit: max 1 call per 5 seconds
      if (timeSinceLastCall < MIN_CALL_INTERVAL) return false;

      // Trigger conditions
      const shouldTrigger =
        payload.priority === "critical" ||
        payload.priority === "high" ||
        // Timeout: at least 1 call per 30s
        timeSinceLastCall > 30000;

      if (shouldTrigger && !state.geminiProcessing && !state.processing) {
        state.lastGeminiCall = now;
        state.geminiProcessing = true;

        // Trigger async Gemini call (fire-and-forget from HTTP handler)
        triggerGeminiWithGameState(payload.data).catch(() => {
          state.geminiProcessing = false;
        });

        return true;
      }

      return false;
    }
    ```
  - Add `triggerGeminiWithGameState(gameState: GameStateData)`:
    ```typescript
    async function triggerGeminiWithGameState(gameState: GameStateData) {
      try {
        const frame = await captureScreen();
        broadcast({ type: "frame", base64: frame.base64, timestamp: frame.timestamp });

        const description = await describeFrame(frame.base64, state.systemPrompt || undefined, gameState);
        const geminiMs = Date.now();
        log("info", "gemini", `Description (game-state triggered, ${geminiMs}ms): ${description}`);
        broadcast({ type: "description", text: description, latency: geminiMs });

        const audioBase64 = await textToSpeech(description);
        broadcast({ type: "audio", data: audioBase64, description, latency: 0 });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log("error", "engine", `Game-state Gemini error: ${msg}`);
      } finally {
        state.geminiProcessing = false;
      }
    }
    ```
  - Modify existing `tick()` function — add guard at the top:
    ```typescript
    async function tick() {
      if (state.processing || state.geminiProcessing) {
        log("warn", "engine", "Previous tick still processing, skipping");
        return;
      }
      // ... rest of existing tick code unchanged ...
    }
    ```
  - **Do NOT modify `_ws.ts` for game state broadcasting** — it remains a command handler only
- **QA**:
  1. Send 20 rapid POST requests: `for i in $(seq 1 20); do curl -s -X POST http://localhost:3000/api/game-state -H "Content-Type: application/json" -d '{"protocolVersion":1,"priority":"high","source":"test","data":{"player":{"health":50,"maxHealth":100,"magicka":100,"stamina":100,"level":10,"position":{"x":0,"y":0,"z":0},"isSneaking":false,"isDead":false},"combatState":1,"enemies":[],"playerAnimation":"Idle","eventType":"tick"},"timestamp":1234567890}'; done`
  2. Check server logs — should see "Gemini rate limited" or skip messages, NOT more than 3 Gemini calls in any 15-second window
  3. Verify all 20 gameState messages still broadcast to WebSocket clients (check dashboard shows live updates)
  4. Verify no crash or race condition errors in logs

**Task 3.3: Enhance Gemini prompt with game state** ✅ DONE
- Modify `server/utils/gemini.ts` — add optional `gameState` parameter:
  ```typescript
  import { google } from "@ai-sdk/google";
  import { generateText } from "ai";
  import type { GameStateData } from "./protocol";

  const DEFAULT_SYSTEM_PROMPT =
    "You are an audio guide for a blind Skyrim player. Describe what you see concisely: enemies, items, terrain, UI elements. Prioritize threats and interactive objects. Be brief and actionable. Max 2-3 sentences. You also receive structured game state data — use it to provide accurate, timely descriptions.";

  export async function describeFrame(
    base64: string,
    systemPrompt?: string,
    gameState?: GameStateData
  ): Promise<string> {
    let userText = "Describe what is happening on screen right now.";

    if (gameState) {
      const { player, combatState, enemies } = gameState;
      const healthPercent = player.maxHealth > 0
        ? Math.round((player.health / player.maxHealth) * 100)
        : 0;
      const combatLabel = combatState === 1 ? "In combat" : "Peaceful";
      const enemyList = enemies
        .map((e) => `${e.name} (${e.distance.toFixed(1)}m, ${e.animation})`)
        .join(", ") || "None";

      userText += `\n\nAdditional context from game state:\n- Player health: ${player.health.toFixed(0)}/${player.maxHealth.toFixed(0)} (${healthPercent}%)\n- Combat state: ${combatLabel}\n- Nearby enemies: ${enemyList}\n- Player animation: ${gameState.playerAnimation}`;
    }

    const { text } = await generateText({
      model: google("gemini-2.0-flash"),
      system: systemPrompt || DEFAULT_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              image: Buffer.from(base64, "base64"),
              mimeType: "image/jpeg",
            },
            {
              type: "text",
              text: userText,
            },
          ],
        },
      ],
    });

    return text;
  }
  ```
- **BACKWARD COMPATIBLE**: `systemPrompt` remains optional, `base64` parameter name unchanged
- Modify `server/utils/engine.ts`:
  - In `tick()`: pass `state.latestGameState?.data` to `describeFrame()`:
    ```typescript
    const description = await describeFrame(
      frame.base64,
      state.systemPrompt || undefined,
      state.latestGameState?.data
    );
    ```
- **QA**:
  1. Send a game state POST with enemies: `curl -X POST http://localhost:3000/api/game-state -H "Content-Type: application/json" -d '{"protocolVersion":1,"priority":"high","source":"test","data":{"player":{"health":80,"maxHealth":100,"magicka":100,"stamina":100,"level":10,"position":{"x":0,"y":0,"z":0},"isSneaking":false,"isDead":false},"combatState":1,"enemies":[{"formId":12345,"name":"Draugr","distance":12.5,"health":50,"level":6,"animation":"AttackStart"}],"playerAnimation":"Idle","eventType":"tick"},"timestamp":1234567890}'`
  2. Wait for next engine tick (3s) and check the Gemini description in server logs
  3. Verify the description text contains "Draugr" or "12.5" or "12" — confirming Gemini used the game state context
  4. Verify existing screenshot-only flow still works when no game state has been sent (backward compatibility)

---

### Phase 4: Dashboard Panel

**Task 4.1: Create GameStatePanel component** ✅ DONE
- Create `src/components/GameStatePanel.tsx`:
  ```tsx
  import { useAppStore } from "../stores/useAppStore";
  import "./GameStatePanel.css";

  export function GameStatePanel() {
    const { gameState, gameStateReceivedAt } = useAppStore();

    if (!gameState) {
      return <div className="game-state-panel disconnected">Waiting for game data...</div>;
    }

    const { player, combatState, enemies } = gameState;
    const healthPercent = (player.health / player.maxHealth) * 100;

    return (
      <div className="game-state-panel">
        <h3>Game State</h3>

        {/* Health bar */}
        <div className="stat-bar">
          <label>Health</label>
          <div className="bar health" style={{ width: `${healthPercent}%` }}>
            {player.health.toFixed(0)} / {player.maxHealth.toFixed(0)}
          </div>
        </div>

        {/* Magicka bar */}
        <div className="stat-bar">
          <label>Magicka</label>
          <div className="bar magicka" style={{ width: `${(player.magicka / 200) * 100}%` }}>
            {player.magicka.toFixed(0)}
          </div>
        </div>

        {/* Stamina bar */}
        <div className="stat-bar">
          <label>Stamina</label>
          <div className="bar stamina" style={{ width: `${(player.stamina / 200) * 100}%` }}>
            {player.stamina.toFixed(0)}
          </div>
        </div>

        {/* Combat state */}
        <div className={`combat-badge ${combatState === 1 ? "in-combat" : "peaceful"}`}>
          {combatState === 1 ? "⚔️ In Combat" : "🕊️ Peaceful"}
        </div>

        {/* Enemies */}
        {enemies.length > 0 && (
          <div className="enemies">
            <h4>Enemies ({enemies.length})</h4>
            {enemies.map((enemy, i) => (
              <div key={i} className="enemy">
                <span className="name">{enemy.name}</span>
                <span className="distance">{enemy.distance.toFixed(1)}m</span>
                <span className="animation">{enemy.animation}</span>
              </div>
            ))}
          </div>
        )}

        {/* Connection status */}
        <div className="connection-status">
          {Date.now() - (gameStateReceivedAt || 0) < 2000 ? "🟢" : "🔴"}
          Last update: {gameStateReceivedAt ? new Date(gameStateReceivedAt).toLocaleTimeString() : "N/A"}
        </div>
      </div>
    );
  }
  ```
- **NOTE**: No useMemo/useCallback — React Compiler is enabled
- Create `src/components/GameStatePanel.css` matching dark theme
- Modify `src/stores/useAppStore.ts`:
  ```typescript
  import type { GameStateData } from "../../server/utils/protocol";

  interface AppState {
    // ... existing fields
    gameState: GameStateData | null;
    gameStateReceivedAt: number | null;

    // ... in handleMessage function, add new case:
    // case "gameState":
    //   set({ gameState: msg.data as GameStateData, gameStateReceivedAt: Date.now() });
    //   break;
  }
  ```
- Modify `src/App.tsx`: add `<GameStatePanel />` to dashboard
- **QA**:
  1. Send test gameState via curl (see Task 3.2 QA)
  2. Open dashboard in browser — verify GameStatePanel appears with health bars, combat badge, enemy list
  3. Verify health bar color changes: >50% green, 25-50% yellow, <25% red
  4. Verify connection indicator: green dot when data received within 2s, red after 2s

---

## Files Changed Summary

| File | Status | Description |
|------|--------|-------------|
| `server/utils/protocol.ts` | NEW | TypeScript interfaces for game state |
| `server/api/game-state.post.ts` | NEW | REST endpoint for POST |
| `server/utils/engine.ts` | MODIFIED | Game state storage + broadcast + Gemini trigger + race condition protection |
| `server/utils/gemini.ts` | MODIFIED | Enhanced prompt with game state (backward-compatible) |
| `server/routes/_ws.ts` | UNCHANGED | Command handler only (no broadcast logic added) |
| `src/components/GameStatePanel.tsx` | NEW | Dashboard panel component |
| `src/components/GameStatePanel.css` | NEW | Panel styles |
| `src/stores/useAppStore.ts` | MODIFIED | Add gameState to store |
| `src/App.tsx` | MODIFIED | Add GameStatePanel to layout |

---

## Momus Review v2 — Resolved Issues

| Finding | Severity | Resolution |
|---------|----------|------------|
| WebSocket broadcast in wrong file | CRITICAL | Moved to engine.ts — broadcast() called inside updateGameState() |
| Race condition with tick pipeline | CRITICAL | Added `geminiProcessing` flag + guard in tick() |
| describeFrame backward compat break | CRITICAL | Kept systemPrompt optional, kept base64 param name |
| QA scenarios not executable | HIGH | Added concrete curl commands and expected outputs |
