<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef } from "vue";
import { storeToRefs } from "pinia";
import { useSessionStore } from "../stores/session";

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
	<section class="flex min-h-0 min-w-0 flex-col bg-default" aria-label="Mod context">
		<div class="flex shrink-0 items-center justify-between border-b border-default px-4 py-2.5">
			<h2 class="font-mono text-[10px] uppercase tracking-[0.16em] text-dimmed">
				Mod context
			</h2>
			<UBadge
				:color="inCombat ? 'error' : 'neutral'"
				variant="subtle"
				size="sm"
			>
				{{ inCombat ? "In combat" : "Clear" }}
			</UBadge>
		</div>

		<div v-if="!gameState || incomplete" class="flex flex-1 flex-col gap-3.5 p-4">
			<p class="text-[12.5px] text-dimmed">
				{{ incomplete
					? "Incomplete game data received"
					: "Waiting for the SKSE plugin. No mod context in a sim session" }}
			</p>
		</div>
		<div v-else-if="gameState.player" class="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4">
			<div class="flex flex-col gap-1.5">
				<div class="flex items-center justify-between">
					<span class="font-mono text-[10px] uppercase tracking-[0.12em] text-dimmed">
						Health
					</span>
					<span class="font-mono text-[10px] tracking-[0.05em] text-primary">
						{{ gameState.player.health.toFixed(0) }} / {{ gameState.player.maxHealth.toFixed(0) }}
					</span>
				</div>
				<div
					id="health-bar"
					aria-label="Health"
					class="gauge-ticks h-3.5 w-full overflow-hidden rounded-sm border border-default bg-elevated"
				>
					<div
						class="h-full bg-error/75 transition-[width] duration-200 ease-out"
						:style="{ width: `${healthPercent(gameState.player.health, gameState.player.maxHealth)}%` }"
					/>
				</div>
			</div>

			<div class="flex flex-col gap-1.5">
				<div class="flex items-center justify-between">
					<span class="font-mono text-[10px] uppercase tracking-[0.12em] text-dimmed">
						Magicka
					</span>
					<span class="font-mono text-[10px] tracking-[0.05em] text-primary">
						{{ gameState.player.magicka.toFixed(0) }}
					</span>
				</div>
				<div
					id="magicka-bar"
					aria-label="Magicka"
					class="gauge-ticks h-3.5 w-full overflow-hidden rounded-sm border border-default bg-elevated"
				>
					<div
						class="h-full bg-primary/70 transition-[width] duration-200 ease-out"
						:style="{ width: `${manaPercent(gameState.player.magicka)}%` }"
					/>
				</div>
			</div>

			<div class="flex flex-col gap-1.5">
				<div class="flex items-center justify-between">
					<span class="font-mono text-[10px] uppercase tracking-[0.12em] text-dimmed">
						Stamina
					</span>
					<span class="font-mono text-[10px] tracking-[0.05em] text-primary">
						{{ gameState.player.stamina.toFixed(0) }}
					</span>
				</div>
				<div
					id="stamina-bar"
					aria-label="Stamina"
					class="gauge-ticks h-3.5 w-full overflow-hidden rounded-sm border border-default bg-elevated"
				>
					<div
						class="h-full bg-success/65 transition-[width] duration-200 ease-out"
						:style="{ width: `${manaPercent(gameState.player.stamina)}%` }"
					/>
				</div>
			</div>

			<div class="flex flex-col gap-1.5 border-t border-default pt-1.5">
				<h4 class="font-mono text-[10px] uppercase tracking-[0.12em] text-dimmed">
					Enemies · {{ gameState.enemies?.length ?? 0 }}
				</h4>
				<p
					v-if="!gameState.enemies || gameState.enemies.length === 0"
					class="text-[12.5px] text-dimmed"
				>
					No nearby enemies
				</p>
				<div
					v-for="enemy in gameState.enemies"
					:key="`${enemy.formId}-${enemy.name}-${enemy.distance}`"
					class="flex items-center justify-between gap-2 rounded-sm border border-default bg-elevated px-2 py-1"
				>
					<span class="truncate text-[12.5px] text-highlighted">{{ enemy.name }}</span>
					<span class="shrink-0 font-mono text-[11px] tabular-nums text-dimmed">
						{{ enemy.distance.toFixed(1) }}m
					</span>
				</div>
			</div>

			<div class="mt-auto flex items-center gap-2 border-t border-default pt-1.5">
				<span
					class="size-[7px] rounded-full"
					:class="isLive
						? 'bg-success shadow-[0_0_6px_rgba(70,214,140,0.5)]'
						: 'bg-error'"
				/>
				<span class="font-mono text-[10.5px] tracking-[0.05em] text-dimmed">
					{{ isLive ? "Live" : "Stale" }}
					<template v-if="gameStateReceivedAt">
						· {{ new Date(gameStateReceivedAt).toLocaleTimeString() }}
					</template>
				</span>
			</div>
		</div>
	</section>
</template>
