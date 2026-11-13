<script setup lang="ts">
// Session page: the live operational surface. Stage on the left, assistant
// telemetry below it, session controls and mod context in the right rail.
import { storeToRefs } from "pinia";
import { useSessionStore } from "../stores/session";
import StatusBar from "../components/StatusBar.vue";
import ScreenViewer from "../components/ScreenViewer.vue";
import ConfigPanel from "../components/ConfigPanel.vue";
import TelemetryPanel from "../components/TelemetryPanel.vue";
import GameStatePanel from "../components/GameStatePanel.vue";

const session = useSessionStore();
const { source } = storeToRefs(session);
</script>

<template>
	<UDashboardPanel
		id="session"
		:ui="{ body: 'flex min-h-0 flex-1 flex-col overflow-hidden p-0' }"
	>
		<template #header>
			<UDashboardNavbar>
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>

				<template #title>
					<span class="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
						Session
					</span>
				</template>

				<template #right>
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
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<StatusBar />

			<!-- Two-column instrument grid: stage column + control rail. Each column
			     manages its own overflow, so nothing can overlap at any width. -->
			<main
				class="grid min-h-0 flex-1 gap-px overflow-y-auto bg-(--ui-border-accented)
					lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden xl:grid-cols-[minmax(0,1fr)_400px]"
			>
				<div class="flex min-h-0 min-w-0 flex-col gap-px">
					<ScreenViewer class="max-lg:h-[52dvh] max-lg:shrink-0" />
					<TelemetryPanel class="min-h-0 flex-1 max-lg:min-h-[420px] max-lg:shrink-0" />
				</div>

				<div
					class="flex min-h-0 min-w-0 flex-col gap-px max-lg:shrink-0
					lg:overflow-y-auto lg:border-l lg:border-(--ui-border-accented)"
				>
					<ConfigPanel class="max-lg:shrink-0" />
					<GameStatePanel class="max-lg:shrink-0" />
				</div>
			</main>
		</template>
	</UDashboardPanel>
</template>
