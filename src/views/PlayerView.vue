<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { playerShell } from "../utils/electron-bridge";
import { useSessionStore } from "../stores/session";
import heroUrl from "../assets/hero.jpg";

// Player surface (/player): the session core with no operator UI. Runs in the
// hidden Electron window (audio straight out, global push-to-talk toggles the
// mic, capture auto-targets the Skyrim window) — or in a plain browser tab
// where the radar/TTS audio must be unlocked by one click first.
//
// The Electron main passes the real PTT key via ?ptt= — the renderer cannot
// read main-process env (and the key is configurable: SKYGUIDE_PTT_KEY).
const session = useSessionStore();
const { serverConnected, isCapturing } = storeToRefs(session);
const listening = ref(false);

const pttKey =
	typeof window !== "undefined"
		? (new URLSearchParams(window.location.search).get("ptt") ?? "F7")
		: "F7";

const listeningLabel = computed(() =>
	listening.value
		? `Écoute active (${pttKey})`
		: `Écoute en veille — ${pttKey} pour parler`,
);

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
		class="fixed inset-0 overflow-hidden bg-[#0c0708] text-default"
		role="status"
		aria-live="polite"
	>
		<!-- Key art: blindfolded Dragonborn, dimmed so status text wins contrast -->
		<img
			:src="heroUrl"
			alt=""
			class="absolute inset-0 h-full w-full object-cover object-[70%_20%] opacity-45"
		/>
		<div
			class="absolute inset-0 bg-gradient-to-t from-[#0c0708] via-[#0c0708]/55 to-[#0c0708]/10"
		/>
		<div
			class="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#0c0708] to-transparent"
		/>

		<!-- Brand block, anchored like the key art title -->
		<div class="absolute inset-x-0 bottom-0 z-10 p-10 sm:p-14">
			<p class="text-red-200/80 text-xs font-medium tracking-[0.45em] uppercase">
				The Elder Scrolls V
			</p>
			<h1
				class="mt-2 text-6xl font-bold tracking-[0.18em] text-[#f5e9e9] drop-shadow-[0_0_18px_rgba(153,27,27,0.55)]"
			>
				SkyGuide
			</h1>
			<div class="mt-4 h-px w-64 bg-red-800/70" />

			<div class="mt-6 space-y-1.5 text-sm">
				<p :class="serverConnected ? 'text-default' : 'text-warning'">
					{{ serverConnected ? "Session connectée au serveur." : "En attente du serveur (port 3000)…" }}
				</p>
				<p class="text-muted">
					Capture Skyrim {{ isCapturing ? "active" : "inactive" }} ·
					<span :class="listening ? 'text-success' : ''">{{ listeningLabel }}</span>
				</p>
			</div>
		</div>
	</main>
</template>
