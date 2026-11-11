<script setup lang="ts">
import { onMounted } from "vue";
import { useSessionStore } from "./stores/session";
import "./App.css";
import StatusBar from "./components/StatusBar.vue";
import ScreenViewer from "./components/ScreenViewer.vue";
import ConfigPanel from "./components/ConfigPanel.vue";
import TelemetryPanel from "./components/TelemetryPanel.vue";
import GameStatePanel from "./components/GameStatePanel.vue";

const session = useSessionStore();

onMounted(() => {
	session.connect();
});
</script>

<template>
	<UApp>
		<div class="console">
			<header class="command-bar">
				<div class="brand">
					<span class="brand-name">SkyGuide</span>
					<span class="brand-sub">Operator Console</span>
				</div>
				<div class="command-slot">
					<span
						class="signal-dot"
						:data-tone="session.serverConnected ? 'live' : 'off'"
						aria-hidden="true"
					/>
					<span class="panel-meta">
						{{ session.serverConnected ? "LINK ONLINE" : "LINK OFFLINE" }}
					</span>
				</div>
			</header>
			<StatusBar />
			<main class="console-grid">
				<ScreenViewer />
				<ConfigPanel />
				<TelemetryPanel />
				<GameStatePanel />
			</main>
		</div>
	</UApp>
</template>
