import { useEffect, useState } from "react";
import { useAppStore } from "../stores/useAppStore";
import "./GameStatePanel.css";

export function GameStatePanel() {
	const gameState = useAppStore((s) => s.gameState);
	const gameStateReceivedAt = useAppStore((s) => s.gameStateReceivedAt);
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const timer = window.setInterval(() => {
			setNow(Date.now());
		}, 500);

		return () => {
			window.clearInterval(timer);
		};
	}, []);

	if (!gameState) {
		return (
			<div className="game-state-panel disconnected">
				<h3>Game State</h3>
				<p className="empty-state">Waiting for game data...</p>
			</div>
		);
	}

	const { player, combatState, enemies } = gameState;
	const healthPercent = player.maxHealth > 0
		? Math.max(0, Math.min((player.health / player.maxHealth) * 100, 100))
		: 0;
	const magickaPercent = Math.max(0, Math.min((player.magicka / 200) * 100, 100));
	const staminaPercent = Math.max(0, Math.min((player.stamina / 200) * 100, 100));
	const isConnected = gameStateReceivedAt !== null && now - gameStateReceivedAt < 2000;

	return (
		<div className="game-state-panel">
			<div className="game-state-header">
				<h3>Game State</h3>
				<span className={`combat-badge ${combatState === 1 ? "in-combat" : "peaceful"}`}>
					{combatState === 1 ? "⚔️ In Combat" : "🕊️ Peaceful"}
				</span>
			</div>

			<div className="stat-row">
				<label htmlFor="health-bar">Health</label>
				<div className="bar-track" id="health-bar" aria-label="Health">
					<div className="bar-fill health" style={{ width: `${healthPercent}%` }}>
						{player.health.toFixed(0)} / {player.maxHealth.toFixed(0)}
					</div>
				</div>
			</div>

			<div className="stat-row">
				<label htmlFor="magicka-bar">Magicka</label>
				<div className="bar-track" id="magicka-bar" aria-label="Magicka">
					<div className="bar-fill magicka" style={{ width: `${magickaPercent}%` }}>
						{player.magicka.toFixed(0)}
					</div>
				</div>
			</div>

			<div className="stat-row">
				<label htmlFor="stamina-bar">Stamina</label>
				<div className="bar-track" id="stamina-bar" aria-label="Stamina">
					<div className="bar-fill stamina" style={{ width: `${staminaPercent}%` }}>
						{player.stamina.toFixed(0)}
					</div>
				</div>
			</div>

			<div className="enemies-section">
				<h4>Enemies ({enemies.length})</h4>
				{enemies.length === 0 ? (
					<p className="empty-state">No nearby enemies</p>
				) : (
					enemies.map((enemy) => (
						<div key={`${enemy.formId}-${enemy.name}-${enemy.distance}`} className="enemy-row">
							<span className="enemy-name">{enemy.name}</span>
							<span className="enemy-distance">{enemy.distance.toFixed(1)}m</span>
						</div>
					))
				)}
			</div>

			<div className="connection-info">
				<span className={`status-dot ${isConnected ? "connected" : "disconnected"}`} />
				<span className="connection-text">
					{isConnected ? "Live" : "Stale"} · Last update:{" "}
					{gameStateReceivedAt ? new Date(gameStateReceivedAt).toLocaleTimeString() : "N/A"}
				</span>
			</div>
		</div>
	);
}
