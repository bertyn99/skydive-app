<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { playerShell } from "../utils/electron-bridge";
import { useSessionStore } from "../stores/session";

// Player surface (/player): the session core with no operator UI. Loaded in
// a hidden Electron window — audio goes straight out, the global push-to-talk
// hotkey (F9) toggles the mic, capture auto-targets the Skyrim window via the
// main process's displayMedia handler. The text below is only visible when
// the operator reveals the window from the tray.
const session = useSessionStore();
const { serverConnected, isCapturing } = storeToRefs(session);
const listening = ref(false);

function setListening(next: boolean): void {
	if (listening.value === next) return;
	listening.value = next;
	if (next) {
		session.startVoice();
	} else {
		session.stopVoice();
	}
}

// Start capture once the WS handshake has landed — clips flow over it.
const stopWaiting = watch(
	serverConnected,
	(connected) => {
		if (connected && !isCapturing.value) {
			session.setSource("screen");
			session.startCapture();
			stopWaiting();
		}
	},
	{ immediate: true },
);

onMounted(() => {
	session.connect();
	playerShell()?.onPtt((action) => setListening(action === "start"));
});
</script>

<template>
	<main
		class="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-default text-default"
		role="status"
		aria-live="polite"
	>
		<h1 class="text-highlighted text-2xl font-semibold tracking-tight">SkyGuide joueur</h1>
		<p class="text-muted text-sm">
			{{
				serverConnected
					? "Session connectée au serveur."
					: "En attente du serveur (port 3000)…"
			}}
		</p>
		<p class="text-muted text-sm">
			Capture Skyrim {{ isCapturing ? "active" : "inactive" }} · écoute
			{{ listening ? "active (F9)" : "en veille (F9 pour parler)" }}
		</p>
	</main>
</template>
