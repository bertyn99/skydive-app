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

/** Autowalk state — "walking"/"arrived" only become real with the ESP (plan W6). */
export type NavigationStatus = "idle" | "walking" | "arrived" | "cancelled" | "failed";

export interface NavigationState {
  status: NavigationStatus;
}

/** Gameplay-blocking menu flags from the plugin's denylist (game-state/menu-state.ts). */
export interface UiState {
  menuOpen: boolean;
  consoleOpen: boolean;
}

/** Scaleform focus on an ItemMenu (inventory / magic / container / …). */
export type MenuFocusEvent = "open" | "focus" | "close";

export interface MenuFocusState {
  name: string;
  /** Absent on ticks where nothing changed — engine must not re-speak. */
  event?: MenuFocusEvent;
  skyui?: boolean;
  category?: string;
  item?: string;
  index?: number;
  count?: number;
  firstRead?: boolean;
  announceCategory?: boolean;
}

export interface GameStateData {
  player: PlayerState;
  combatState: number;
  enemies: EnemyState[];
  playerAnimation: string;
  eventType: GameEventType;
  /**
   * Protocol-v1 ADDITIVE extensions (skyguide-skse serializer). Absent
   * fields mean an old plugin — treat as feature-off, never as false.
   * Reflex/arbiter/radar read these (fast lane); the state.json dump only
   * feeds Gate/Composer context (see docs/adr/0003-state-channels.md).
   */
  headingAngleZ?: number;
  isStuck?: boolean;
  /** Player-relative bearing of the nearest obstacle when stuck (°, -180..180). */
  stuckRelDeg?: number;
  navigation?: NavigationState;
  ui?: UiState;
  menu?: MenuFocusState;
}

export interface GameStatePayload {
  protocolVersion: number;
  priority: PriorityLevel;
  source: string;
  data: GameStateData;
  timestamp: number;
  /**
   * Additive (ADR 0003): the parallel-array mod-context dump riding the
   * protocol POST. The file lane (state.json) is unavailable in the Skyrim
   * Platform runtime (empty `fs` shim), so the plugin embeds the same
   * payload here; `parseSkyrimState` consumes it unchanged.
   */
  context?: Record<string, unknown> | null;
}

export interface GameStateResponse {
  status: "ok" | "error";
  /** True when the payload raised the engine's urgency flag (cooldown bypass). */
  urgent?: boolean;
  error?: string;
  serverTimestamp: number;
}
