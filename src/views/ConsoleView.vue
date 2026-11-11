<script setup lang="ts">
import { onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useSessionStore } from "../stores/session";
import StatusBar from "../components/StatusBar.vue";
import ScreenViewer from "../components/ScreenViewer.vue";
import ConfigPanel from "../components/ConfigPanel.vue";
import TelemetryPanel from "../components/TelemetryPanel.vue";
import GameStatePanel from "../components/GameStatePanel.vue";

const session = useSessionStore();
const { serverConnected } = storeToRefs(session);

onMounted(() => {
	session.connect();
});
</script>

<template>
	<UDashboardGroup>
		<UDashboardPanel id="console">
			<template #header>
				<UDashboardNavbar>
					<template #title>
						<div class="flex items-baseline gap-2.5">
							<span class="text-base font-semibold tracking-tight text-highlighted">
								SkyGuide
							</span>
							<span class="font-mono text-[10px] uppercase tracking-[0.14em] text-dimmed">
								Operator Console
							</span>
						</div>
					</template>
					<template #right>
						<div class="flex items-center gap-2">
							<span
								class="size-[7px] rounded-full"
								:class="serverConnected
									? 'bg-primary shadow-[0_0_6px_rgba(45,212,191,0.5)]'
									: 'bg-error'"
								aria-hidden="true"
							/>
							<span class="font-mono text-[10px] tracking-[0.08em] text-muted">
								{{ serverConnected ? "LINK ONLINE" : "LINK OFFLINE" }}
							</span>
						</div>
					</template>
				</UDashboardNavbar>
				<StatusBar />
			</template>

			<main
				class="grid min-h-0 flex-1 gap-px bg-(--ui-border-accented)
					max-lg:grid-cols-1 max-lg:grid-rows-[minmax(320px,55dvh)_auto_auto_auto]
					lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[minmax(0,1.55fr)_minmax(0,1fr)]"
			>
				<ScreenViewer />
				<ConfigPanel />
				<TelemetryPanel />
				<GameStatePanel />
			</main>
		</UDashboardPanel>
	</UDashboardGroup>
</template>
