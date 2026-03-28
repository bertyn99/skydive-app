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
