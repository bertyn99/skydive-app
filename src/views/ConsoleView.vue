<script setup lang="ts">
import { onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useSessionStore } from "../stores/session";
import StatusBar from "../components/StatusBar.vue";
import ScreenViewer from "../components/ScreenViewer.vue";
import ConfigPanel from "../components/ConfigPanel.vue";
import TelemetryPanel from "../components/TelemetryPanel.vue";
import GameStatePanel from "../components/GameStatePanel.vue";
import EvalsPanel from "../components/EvalsPanel.vue";

const session = useSessionStore();
const { serverConnected, source } = storeToRefs(session);

onMounted(() => {
	session.connect();
});
</script>

<template>
	<UDashboardGroup>
		<UDashboardPanel id="console">
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
					<div class="flex items-center gap-3">
						<UFieldGroup size="xs">
							<UButton
								label="Live"
								:color="source === 'screen' ? 'primary' : 'neutral'"
								:variant="source === 'screen' ? 'subtle' : 'soft'"
								:disabled="source === 'screen'"
								@click="session.setSource('screen')"
							/>
							<UButton
								label="Sim"
								:color="source === 'video-file' ? 'primary' : 'neutral'"
								:variant="source === 'video-file' ? 'subtle' : 'soft'"
								:disabled="source === 'video-file'"
								@click="session.setSource('video-file')"
							/>
						</UFieldGroup>
						<USeparator orientation="vertical" class="h-4" />
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
					</div>
				</template>
			</UDashboardNavbar>
			<StatusBar />

			<main
				class="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto bg-(--ui-border-accented)
					lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[minmax(0,1.55fr)_minmax(0,1fr)_auto] lg:overflow-hidden"
			>
				<ScreenViewer class="max-lg:min-h-[55dvh] max-lg:shrink-0" />
				<ConfigPanel class="max-lg:shrink-0" />
				<TelemetryPanel class="max-lg:shrink-0" />
				<GameStatePanel class="max-lg:shrink-0" />
				<EvalsPanel class="max-lg:shrink-0 lg:col-span-2" />
			</main>
		</UDashboardPanel>
	</UDashboardGroup>
</template>
