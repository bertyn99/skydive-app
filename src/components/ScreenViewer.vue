<script setup lang="ts">
import { watchEffect, ref } from "vue";
import { storeToRefs } from "pinia";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
const { mediaStream, isCapturing, captureInterval } = storeToRefs(session);

const videoRef = ref<HTMLVideoElement | null>(null);

watchEffect(() => {
	if (videoRef.value) {
		videoRef.value.srcObject = mediaStream.value;
	}
});
</script>

<template>
	<section class="panel stage-panel" aria-label="Video stage">
		<div class="panel-head">
			<h2 class="panel-title">Stage · Source</h2>
			<span class="panel-meta">live session</span>
		</div>
		<div class="stage-body">
			<div class="stage-frame">
				<video v-if="mediaStream" ref="videoRef" autoplay muted playsInline />
				<div v-else class="stage-empty">
					<span class="stage-empty-title">No source</span>
					<span class="stage-empty-hint">
						{{ isCapturing ? "Starting capture…" : "Start capture to feed the assistant from the screen." }}
					</span>
				</div>
				<div class="hud" aria-hidden="true">
					<span class="hud-chip">
						<span v-if="isCapturing" class="rec-dot" aria-hidden="true" />
						{{ isCapturing ? "REC" : "STANDBY" }}
					</span>
					<span class="hud-chip">CLIP {{ captureInterval }}MS</span>
				</div>
			</div>
		</div>
	</section>
</template>
