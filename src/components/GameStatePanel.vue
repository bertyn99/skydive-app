<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef } from "vue";
import { storeToRefs } from "pinia";
import { useSessionStore } from "../stores/session";
import "./GameStatePanel.css";

const session = useSessionStore();
const { gameState, gameStateReceivedAt } = storeToRefs(session);

const now = shallowRef(Date.now());
let timer: number | undefined;

onMounted(() => {
	timer = window.setInterval(() => {
		now.value = Date.now();
	}, 500);
});

onUnmounted(() => {
	window.clearInterval(timer);
});

const inCombat = computed(() => gameState.value?.combatState === 1);
const incomplete = computed(
	() =>
		gameState.value !== null &&
		(gameState.value.player === null ||
			gameState.value.combatState === null ||
			gameState.value.enemies === null),
);
const isLive = computed(
	() =>
		gameStateReceivedAt.value !== null &&
		now.value - gameStateReceivedAt.value < 2000,
);

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
</script>

<template>
	<section
		class="game-state-panel"
		aria-label="Mod context"
		:data-active="gameState !== null"
	>
		<div class="panel-head">
			<h2 class="panel-title">Mod context</h2>
			<span
				class="combat-badge"
				:class="inCombat ? 'in-combat' : 'peaceful'"
			>
				{{ inCombat ? "In combat" : "Clear" }}
			</span>
		</div>

		<div v-if="!gameState || incomplete" class="panel-body">
			<p class="empty-state">
				{{ incomplete
					? "Incomplete game data received"
					: "Waiting for the SKSE plugin — no mod context in a sim session" }}
			</p>
		</div>
		<div v-else-if="gameState.player" class="panel-body">
			<div class="stat-row">
				<label class="field-label" for="health-bar">
					Health
					<span class="value">
						{{ gameState.player.health.toFixed(0) }} /
						{{ gameState.player.maxHealth.toFixed(0) }}
					</span>
				</label>
				<div id="health-bar" class="bar-track" aria-label="Health">
					<div
						class="bar-fill health"
						:style="{ width: `${healthPercent(gameState.player.health, gameState.player.maxHealth)}%` }"
					/>
				</div>
			</div>

			<div class="stat-row">
				<label class="field-label" for="magicka-bar">
					Magicka
					<span class="value">{{ gameState.player.magicka.toFixed(0) }}</span>
				</label>
				<div id="magicka-bar" class="bar-track" aria-label="Magicka">
					<div
						class="bar-fill magicka"
						:style="{ width: `${manaPercent(gameState.player.magicka)}%` }"
					/>
				</div>
			</div>

			<div class="stat-row">
				<label class="field-label" for="stamina-bar">
					Stamina
					<span class="value">{{ gameState.player.stamina.toFixed(0) }}</span>
				</label>
				<div id="stamina-bar" class="bar-track" aria-label="Stamina">
					<div
						class="bar-fill stamina"
						:style="{ width: `${manaPercent(gameState.player.stamina)}%` }"
					/>
				</div>
			</div>

			<div class="enemies-section">
				<h4 class="field-label">Enemies · {{ gameState.enemies?.length ?? 0 }}</h4>
				<p v-if="!gameState.enemies || gameState.enemies.length === 0" class="empty-state">
					No nearby enemies
				</p>
				<div
					v-for="enemy in gameState.enemies"
					:key="`${enemy.formId}-${enemy.name}-${enemy.distance}`"
					class="enemy-row"
				>
					<span class="enemy-name">{{ enemy.name }}</span>
					<span class="enemy-distance">{{ enemy.distance.toFixed(1) }}m</span>
				</div>
			</div>

			<div class="connection-info">
				<span class="signal-dot" :data-tone="isLive ? 'ok' : 'off'" />
				<span class="connection-text">
					{{ isLive ? "Live" : "Stale" }}
					<template v-if="gameStateReceivedAt">
						· {{ new Date(gameStateReceivedAt).toLocaleTimeString() }}
					</template>
				</span>
			</div>
		</div>
	</section>
</template>
