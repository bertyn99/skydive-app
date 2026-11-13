<script setup lang="ts">
import { shallowRef, useTemplateRef, watch, watchEffect } from "vue";
import { storeToRefs } from "pinia";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
const {
	source,
	mediaStream,
	isCapturing,
	captureInterval,
	videoFileStream,
	videoPlaying,
} = storeToRefs(session);

const stageVideo = useTemplateRef<HTMLVideoElement>("stageVideo");

// Sim playback state (DOM-owned here; the store only tracks playing state)
const videoFileUrl = shallowRef<string | null>(null);
const videoFileName = shallowRef<string | null>(null);
const currentTime = shallowRef(0);
const duration = shallowRef(0);
const loop = shallowRef(true);

function formatTime(seconds: number): string {
	const s = Math.max(0, Math.floor(seconds));
	const m = Math.floor(s / 60);
	return `${m}:${String(s % 60).padStart(2, "0")}`;
}

// Live source: mirror the captured stream into the preview element.
watchEffect(() => {
	if (source.value === "screen" && stageVideo.value) {
		stageVideo.value.srcObject = mediaStream.value;
	}
});

function onFileSelect(file: File | File[] | null | undefined) {
	const picked = Array.isArray(file) ? file[0] : file;
	if (!picked) return;
	if (isCapturing.value) {
		session.stopCapture();
	}
	if (videoFileUrl.value) {
		URL.revokeObjectURL(videoFileUrl.value);
	}
	videoFileUrl.value = URL.createObjectURL(picked);
	videoFileName.value = picked.name;
	currentTime.value = 0;
	duration.value = 0;
}

// Hand the element's capture stream to the store once metadata is ready.
function onLoadedMetadata() {
	const el = stageVideo.value;
	if (!el || source.value !== "video-file") return;
	duration.value = el.duration;
	// captureStream() is not in the DOM lib types yet; guard the two
	// engine-specific spellings structurally instead of casting.
	const capturable = el as HTMLVideoElement & {
		captureStream?: () => MediaStream;
		mozCaptureStream?: () => MediaStream;
	};
	if (typeof capturable.captureStream === "function") {
		session.setVideoFileStream(capturable.captureStream());
	} else if (typeof capturable.mozCaptureStream === "function") {
		session.setVideoFileStream(capturable.mozCaptureStream());
	} else {
		session.addLog("error", "capture", "captureStream() not supported in this browser");
	}
}

function onEnded() {
	videoPlaying.value = false;
	if (loop.value && videoFileUrl.value) {
		void stageVideo.value?.play();
	}
}

function togglePlay() {
	const el = stageVideo.value;
	if (!el) return;
	if (el.paused) {
		void el.play();
	} else {
		el.pause();
	}
}

function seek(value: number | undefined) {
	if (value === undefined) return;
	const el = stageVideo.value;
	if (!el) return;
	el.currentTime = value;
	currentTime.value = value;
}

// Auto-play when a sim capture starts so the clip loop has live frames.
watch(isCapturing, (capturing) => {
	if (capturing && source.value === "video-file") {
		void stageVideo.value?.play().catch(() => {});
	}
});

// Releasing the file cleans up stream + object URL.
watch([videoFileUrl, videoFileStream], ([url, stream]) => {
	if (!url && stream) {
		session.setVideoFileStream(null);
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
				{{ source === "screen" ? "Live session" : "Sim session" }}
			</UBadge>
		</div>
		<div class="flex flex-1 flex-col p-4">
			<div
				v-if="source === 'screen'"
				class="stage-frame relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-default bg-[#05070b] transition-colors duration-300 hover:border-(--ui-border-accented)"
			>
				<video v-if="mediaStream" ref="stageVideo" autoplay muted playsInline class="size-full object-contain" />
				<div v-else-if="isCapturing" class="flex items-center gap-2 font-mono text-[11px] text-muted">
					<UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
					Starting capture…
				</div>
				<!-- Idle: radar sweep communicates "waiting for a source" -->
				<div v-else class="flex flex-col items-center gap-4 px-6 text-center">
					<div class="stage-radar" aria-hidden="true">
						<div class="stage-radar-sweep" />
						<UIcon name="i-lucide-video" class="stage-radar-icon size-6" />
					</div>
					<div class="flex flex-col gap-1">
						<p class="font-mono text-[11px] uppercase tracking-[0.16em] text-dimmed">
							No source
						</p>
						<p class="max-w-[40ch] text-[13px] leading-relaxed text-muted">
							Start capture to feed the assistant from the screen.
						</p>
					</div>
				</div>
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

			<div v-else class="flex min-h-0 flex-1 flex-col gap-3">
				<UFileUpload
					v-if="!videoFileUrl"
					accept="video/*"
					:multiple="false"
					:dropzone="true"
					class="min-h-0 flex-1"
					@update:model-value="onFileSelect"
				/>

				<template v-else>
					<div
						class="stage-frame relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-default bg-[#05070b]"
					>
						<video
							ref="stageVideo"
							:src="videoFileUrl"
							muted
							playsInline
							class="size-full object-contain"
							@loadedmetadata="onLoadedMetadata"
							@timeupdate="currentTime = stageVideo?.currentTime ?? 0"
							@play="videoPlaying = true"
							@pause="videoPlaying = false"
							@ended="onEnded"
						/>
						<div class="pointer-events-none absolute inset-x-3 top-2.5 z-20 flex items-center justify-between">
							<UBadge
								color="neutral"
								variant="solid"
								class="max-w-56 border border-(--ui-border-accented) bg-black/70 font-mono text-[10px] tracking-[0.05em] text-muted backdrop-blur-sm"
							>
								<span class="truncate">{{ videoFileName }}</span>
							</UBadge>
							<UBadge
								color="neutral"
								variant="solid"
								class="border border-(--ui-border-accented) bg-black/70 font-mono text-[10px] uppercase tracking-[0.1em] text-muted backdrop-blur-sm"
							>
								<span
									v-if="isCapturing && videoPlaying"
									class="mr-1.5 size-1.5 animate-pulse rounded-full bg-error"
									aria-hidden="true"
								/>
								{{ isCapturing ? (videoPlaying ? "STREAMING" : "HOLD") : "IDLE" }}
							</UBadge>
						</div>
					</div>

					<div class="flex shrink-0 items-center gap-3 rounded-lg border border-default bg-elevated px-3 py-2">
						<UButton
							:icon="videoPlaying ? 'i-lucide-pause' : 'i-lucide-play'"
							color="neutral"
							variant="soft"
							size="xs"
							:aria-label="videoPlaying ? 'Pause video' : 'Play video'"
							@click="togglePlay"
						/>
						<USlider
							:model-value="currentTime"
							:min="0"
							:max="duration || 1"
							:step="0.5"
							class="flex-1"
							:aria-label="'Seek'"
							@update:model-value="seek"
						/>
						<span class="font-mono text-[10px] tabular-nums text-dimmed">
							{{ formatTime(currentTime) }} / {{ formatTime(duration) }}
						</span>
						<USwitch
							v-model="loop"
							size="xs"
							aria-label="Loop video"
						/>
						<UBadge
							:color="isCapturing ? 'primary' : 'neutral'"
							variant="subtle"
							size="sm"
						>
							{{ isCapturing ? "Feeding pipeline" : "Pipeline idle" }}
						</UBadge>
					</div>
				</template>
			</div>
		</div>
	</section>
</template>
