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

	const inCombat = gameState?.combatState === 1;
	const incomplete =
		gameState !== null &&
		(gameState.player === null ||
			gameState.combatState === null ||
			gameState.enemies === null);

	return (
		<section
			className="game-state-panel"
			aria-label="Mod context"
			data-active={gameState !== null}
		>
			<div className="panel-head">
				<h2 className="panel-title">Mod context</h2>
				<span
					className={`combat-badge ${inCombat ? "in-combat" : "peaceful"}`}
				>
					{inCombat ? "In combat" : "Clear"}
				</span>
			</div>

			{!gameState || incomplete ? (
				<div className="panel-body">
					<p className="empty-state">
						{incomplete
							? "Incomplete game data received"
							: "Waiting for the SKSE plugin — no mod context in a sim session"}
					</p>
				</div>
			) : (
				<div className="panel-body">
					<div className="stat-row">
						<label className="field-label" htmlFor="health-bar">
							Health
							<span className="value">
								{gameState.player.health.toFixed(0)} /{" "}
								{gameState.player.maxHealth.toFixed(0)}
							</span>
						</label>
						<div
							className="bar-track"
							id="health-bar"
							aria-label="Health"
						>
							<div
								className="bar-fill health"
								style={{
									width: `${healthPercent(gameState.player.health, gameState.player.maxHealth)}%`,
								}}
							/>
						</div>
					</div>

					<div className="stat-row">
						<label className="field-label" htmlFor="magicka-bar">
							Magicka
							<span className="value">
								{gameState.player.magicka.toFixed(0)}
							</span>
						</label>
						<div
							className="bar-track"
							id="magicka-bar"
							aria-label="Magicka"
						>
							<div
								className="bar-fill magicka"
								style={{ width: `${manaPercent(gameState.player.magicka)}%` }}
							/>
						</div>
					</div>

					<div className="stat-row">
						<label className="field-label" htmlFor="stamina-bar">
							Stamina
							<span className="value">
								{gameState.player.stamina.toFixed(0)}
							</span>
						</label>
						<div
							className="bar-track"
							id="stamina-bar"
							aria-label="Stamina"
						>
							<div
								className="bar-fill stamina"
								style={{ width: `${manaPercent(gameState.player.stamina)}%` }}
							/>
						</div>
					</div>

					<div className="enemies-section">
						<h4 className="field-label">
							Enemies · {gameState.enemies?.length ?? 0}
						</h4>
						{!gameState.enemies || gameState.enemies.length === 0 ? (
							<p className="empty-state">No nearby enemies</p>
						) : (
							gameState.enemies.map((enemy) => (
								<div
									key={`${enemy.formId}-${enemy.name}-${enemy.distance}`}
									className="enemy-row"
								>
									<span className="enemy-name">{enemy.name}</span>
									<span className="enemy-distance">
										{enemy.distance.toFixed(1)}m
									</span>
								</div>
							))
						)}
					</div>

					<div className="connection-info">
						<span
							className="signal-dot"
							data-tone={isLive(gameStateReceivedAt, now) ? "ok" : "off"}
						/>
						<span className="connection-text">
							{isLive(gameStateReceivedAt, now) ? "Live" : "Stale"}
							{gameStateReceivedAt
								? ` · ${new Date(gameStateReceivedAt).toLocaleTimeString()}`
								: ""}
						</span>
					</div>
				</div>
			)}
		</section>
	);
}

function healthPercent(health: number, maxHealth: number): number {
	if (maxHealth <= 0) return 0;
	return clamp((health / maxHealth) * 100);
}

function manaPercent(value: number): number {
	return clamp((value / 200) * 100);
}

function clamp(value: number): number {
	return Math.max(0, Math.min(value, 100));
}

function isLive(receivedAt: number | null, now: number): boolean {
	return receivedAt !== null && now - receivedAt < 2000;
}
