<script setup lang="ts">
import { nextTick, shallowRef, watch } from "vue";
import { storeToRefs } from "pinia";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
const {
	logs,
	lastDescription,
	isPlaying,
	nowPlayingText,
	audioQueue,
} = storeToRefs(session);

const logStreamRef = shallowRef<HTMLElement | null>(null);

// Keep the stream pinned to the latest entries, like a console tail.
watch(
	logs,
	async () => {
		await nextTick();
		const el = logStreamRef.value;
		if (el) el.scrollTop = el.scrollHeight;
	},
	{ flush: "post" },
);
</script>

<template>
	<section class="panel telemetry-panel" aria-label="Assistant telemetry">
		<div class="panel-head">
			<h2 class="panel-title">Assistant telemetry</h2>
			<UButton
				color="neutral"
				variant="ghost"
				size="xs"
				label="Clear"
				@click="session.clearLogs()"
			/>
		</div>
		<div class="panel-body">
			<p v-if="lastDescription" class="observation">
				{{ lastDescription }}
			</p>
			<p v-else class="observation-empty">
				No observation yet — silence is the default
			</p>

			<div class="audio-line">
				<span v-if="isPlaying && nowPlayingText" class="playing">
					<span class="tag">now</span> {{ nowPlayingText }}
				</span>
				<span v-else class="queued">
					<span class="tag">now</span> nothing playing
				</span>
				<template v-if="audioQueue.length > 0">
					<span
						v-for="(item, i) in audioQueue"
						:key="i"
						class="queued"
					>
						<span class="tag">next +{{ i + 1 }} · {{ item.priority }}</span>
						{{ item.text }}
					</span>
				</template>
				<span v-else class="queued">
					<span class="tag">queue</span> empty
				</span>
			</div>

			<div ref="logStreamRef" class="log-stream">
				<div
					v-for="log in logs"
					:key="log.id"
					class="log-row"
					:data-level="log.level"
				>
					<span class="log-time">
						{{ new Date(log.timestamp).toLocaleTimeString() }}
					</span>
					<span class="log-src">[{{ log.source }}]</span>
					<span class="log-msg">{{ log.message }}</span>
				</div>
			</div>
		</div>
	</section>
</template>
