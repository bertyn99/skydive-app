# Plan: skydive-app Modifications

> Changes to the existing skydive-app to receive game state from the SkyGuide Skyrim plugin.

---

## Context

- **Parent project**: SkyGuide (global plan at `../.sisyphus/plans/skyguide-project.md`)
- **Existing stack**: React 19 + Nitro 3 + Gemini 2.0 Flash + Mistral TTS
- **New features**: REST endpoint for game state, engine integration, dashboard panel

---

## Tasks

### Phase 0: Protocol Types

**Task 0.3: Create protocol types**
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
- **QA**: TypeScript compiles without errors

---

### Phase 2: REST Endpoint

**Task 2.2: Create POST /api/game-state endpoint**
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
- **QA**: Send test POST with curl/Postman, verify 200 response. Send invalid payload, verify 400.

---

### Phase 3: Engine + Gemini Integration

**Task 3.2: Implement Gemini rate limiting**
- Modify `server/utils/engine.ts`:
  - Add `latestGameState: GameStatePayload | null` to engine state
  - Add `lastGeminiCall: number` for rate limiting
  - Add `updateGameState(payload: GameStatePayload): boolean`:
    - Store payload in `latestGameState`
    - Return `true` if Gemini should be triggered
    - Gemini trigger conditions:
      - Priority CRITICAL or HIGH
      - Priority change from previous
      - State delta > threshold (>20% health, new enemy)
      - Timeout: at least 1 call per 30s
    - Rate limit: max 1 call per 5 seconds
- Modify `server/routes/_ws.ts`:
  - Broadcast gameState to all WebSocket clients:
    ```typescript
    if (latestGameState) {
      broadcast({
        type: "gameState",
        data: latestGameState.data,
        priority: latestGameState.priority,
        timestamp: latestGameState.timestamp
      });
    }
    ```
- **QA**: Send rapid game state updates → verify Gemini stays under 15 RPM.

**Task 3.3: Enhance Gemini prompt**
- Modify `server/utils/gemini.ts`:
  - Update `describeFrame` signature:
    ```typescript
    export async function describeFrame(
      base64Image: string,
      systemPrompt: string,
      gameState?: GameStateData
    ): Promise<string>
    ```
  - When gameState provided, append to user message:
    ```
    Additional context from game state:
    - Player health: ${health}/${maxHealth} (${percentage}%)
    - Combat state: ${combatState === 1 ? "In combat" : "Peaceful"}
    - Nearby enemies: ${enemies.map(e => `${e.name} (${e.distance}m, ${e.animation})`).join(", ")}
    ```
- Modify `server/utils/engine.ts`:
  - In `tick()`: pass `latestGameState?.data` to `describeFrame()`
- **QA**: Verify Gemini descriptions mention enemy names/distances from game state.

---

### Phase 4: Dashboard Panel

**Task 4.1: Create GameStatePanel component**
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
- Create `src/components/GameStatePanel.css` matching dark theme
- Modify `src/stores/useAppStore.ts`:
  ```typescript
  interface AppStore {
    // ... existing fields
    gameState: GameStateData | null;
    gameStateReceivedAt: number | null;
    
    // ... in handleMessage
    if (msg.type === "gameState") {
      set({ gameState: msg.data, gameStateReceivedAt: Date.now() });
    }
  }
  ```
- Modify `src/App.tsx`: add `<GameStatePanel />` to dashboard
- **QA**: Send test gameState via POST, verify panel displays correctly with live updates.

---

## Files Changed Summary

| File | Status | Description |
|------|--------|-------------|
| `server/utils/protocol.ts` | NEW | TypeScript interfaces for game state |
| `server/api/game-state.post.ts` | NEW | REST endpoint for POST |
| `server/utils/engine.ts` | MODIFIED | Game state storage + Gemini trigger |
| `server/utils/gemini.ts` | MODIFIED | Enhanced prompt with game state |
| `server/routes/_ws.ts` | MODIFIED | Broadcast gameState to clients |
| `src/components/GameStatePanel.tsx` | NEW | Dashboard panel component |
| `src/components/GameStatePanel.css` | NEW | Panel styles |
| `src/stores/useAppStore.ts` | MODIFIED | Add gameState to store |
| `src/App.tsx` | MODIFIED | Add GameStatePanel to layout |
