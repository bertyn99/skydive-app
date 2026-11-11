<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
const {
	serverConnected,
	isCapturing,
	isPlaying,
	captureInterval,
	audioQueue,
	voiceStatus,
	lastQuestion,
} = storeToRefs(session);

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
	<div class="status-strip" role="status" aria-label="Session status">
		<div class="status-cell">
			<span class="status-label">server</span>
			<span class="status-value">
				<span
					class="signal-dot"
					:data-tone="serverConnected ? 'ok' : 'off'"
				/>
				<span>{{ serverConnected ? "online" : "offline" }}</span>
			</span>
		</div>

		<div class="status-cell">
			<span class="status-label">capture</span>
			<span class="status-value">
				<span class="signal-dot" :data-tone="isCapturing ? 'live' : undefined" />
				<span>{{ isCapturing ? `running · ${captureInterval}ms` : "idle" }}</span>
			</span>
		</div>

		<div class="status-cell">
			<span class="status-label">audio</span>
			<span class="status-value">
				<span class="signal-dot" :data-tone="isPlaying ? 'ok' : undefined" />
				<span>{{ audioLabel }}</span>
			</span>
		</div>

		<div class="status-cell">
			<span class="status-label">voice</span>
			<span class="status-value">
				<span class="signal-dot" :data-tone="voiceTone" />
				<span>
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
</template>
