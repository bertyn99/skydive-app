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
	<section class="flex min-h-0 min-w-0 flex-col bg-default" aria-label="Video stage">
		<div class="flex shrink-0 items-center justify-between border-b border-default px-4 py-2.5">
			<h2 class="font-mono text-[10px] uppercase tracking-[0.16em] text-dimmed">
				Stage · Source
			</h2>
			<UBadge color="neutral" variant="subtle" size="sm">
				Live session
			</UBadge>
		</div>
		<div class="flex flex-1 p-4">
			<div
				class="stage-frame relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-default bg-[#05070b]"
			>
				<video v-if="mediaStream" ref="videoRef" autoplay muted playsInline class="size-full object-contain" />
				<UEmpty
					v-else
					:icon="isCapturing ? 'i-lucide-loader-circle' : 'i-lucide-video-off'"
					:title="isCapturing ? 'Starting capture…' : 'No source'"
					:description="isCapturing ? undefined : 'Start capture to feed the assistant from the screen.'"
					class="text-muted"
				/>
				<div class="pointer-events-none absolute inset-x-3 top-2.5 z-20 flex items-center justify-between">
					<UBadge
						color="neutral"
						variant="solid"
						class="border border-(--ui-border-accented) bg-black/70 font-mono text-[10px] uppercase tracking-[0.1em] text-muted backdrop-blur-sm"
					>
						<span
							v-if="isCapturing"
							class="mr-1.5 size-1.5 animate-pulse rounded-full bg-error"
							aria-hidden="true"
						/>
						{{ isCapturing ? "REC" : "STANDBY" }}
					</UBadge>
					<UBadge
						color="neutral"
						variant="solid"
						class="border border-(--ui-border-accented) bg-black/70 font-mono text-[10px] uppercase tracking-[0.1em] text-muted backdrop-blur-sm"
					>
						CLIP {{ captureInterval }}MS
					</UBadge>
				</div>
			</div>
		</div>
	</section>
</template>
