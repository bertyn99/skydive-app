<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
const {
	serverConnected,
	source,
	isCapturing,
	isPlaying,
	captureInterval,
	audioQueue,
	voiceStatus,
	lastQuestion,
} = storeToRefs(session);

function toneClass(tone: string | undefined): string {
	switch (tone) {
		case "ok":
			return "bg-success shadow-[0_0_6px_rgba(70,214,140,0.5)]";
		case "live":
			return "bg-primary shadow-[0_0_6px_rgba(45,212,191,0.5)]";
		case "warn":
			return "bg-warning shadow-[0_0_6px_rgba(232,179,65,0.45)]";
		case "off":
			return "bg-error";
		default:
			return "bg-accented";
	}
}

const voiceTone = computed(() =>
	voiceStatus.value === "wake-detected"
		? "ok"
		: voiceStatus.value === "listening"
			? "warn"
			: undefined,
);

const voiceLabel = computed(() =>
	voiceStatus.value === "wake-detected"
		? "wake"
		: voiceStatus.value === "listening"
			? "listening"
			: "off",
);

const audioLabel = computed(() =>
	isPlaying.value
		? "playing"
		: audioQueue.value.length > 0
			? `${audioQueue.value.length} queued`
			: "idle",
);
</script>

<template>
	<UDashboardToolbar>
		<div
			class="flex w-full items-stretch divide-x divide-(--ui-border) overflow-hidden"
			role="status"
			aria-label="Session status"
		>
			<div class="flex min-w-0 flex-1 items-center gap-2 px-4 py-1.5">
				<span class="font-mono text-[10px] uppercase tracking-[0.12em] text-dimmed">
					Server
				</span>
				<span class="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted">
					<span
						class="size-[7px] shrink-0 rounded-full"
						:class="toneClass(serverConnected ? 'ok' : 'off')"
					/>
					<span class="truncate">{{ serverConnected ? "online" : "offline" }}</span>
				</span>
			</div>

			<div class="flex min-w-0 flex-1 items-center gap-2 px-4 py-1.5">
				<span class="font-mono text-[10px] uppercase tracking-[0.12em] text-dimmed">
					Capture
				</span>
				<span class="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted">
					<span
						class="size-[7px] shrink-0 rounded-full"
						:class="toneClass(isCapturing ? 'live' : undefined)"
					/>
					<span class="truncate">
						{{ isCapturing
							? `running · ${source === "video-file" ? "sim" : "live"} · ${captureInterval}ms`
							: "idle" }}
					</span>
				</span>
			</div>

			<div class="flex min-w-0 flex-1 items-center gap-2 px-4 py-1.5">
				<span class="font-mono text-[10px] uppercase tracking-[0.12em] text-dimmed">
					Audio
				</span>
				<span class="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted">
					<span
						class="size-[7px] shrink-0 rounded-full"
						:class="toneClass(isPlaying ? 'ok' : undefined)"
					/>
					<span class="truncate">{{ audioLabel }}</span>
				</span>
			</div>

			<div class="flex min-w-0 flex-1 items-center gap-2 px-4 py-1.5">
				<span class="font-mono text-[10px] uppercase tracking-[0.12em] text-dimmed">
					Voice
				</span>
				<span class="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted">
					<span
						class="size-[7px] shrink-0 rounded-full"
						:class="toneClass(voiceTone)"
					/>
					<span class="truncate">
						{{ voiceLabel }}
						<span
							v-if="lastQuestion && voiceStatus !== 'off'"
							:title="lastQuestion"
						>
							— “{{ lastQuestion.length > 30 ? `${lastQuestion.slice(0, 30)}…` : lastQuestion }}”
						</span>
					</span>
				</span>
			</div>
		</div>
	</UDashboardToolbar>
</template>
