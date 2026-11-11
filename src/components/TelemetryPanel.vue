<script setup lang="ts">
import { nextTick, shallowRef, watch } from "vue";
import { storeToRefs } from "pinia";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
const { logs, lastDescription, isPlaying, nowPlayingText, audioQueue } =
	storeToRefs(session);

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
	<section class="flex min-h-0 min-w-0 flex-col bg-default" aria-label="Assistant telemetry">
		<div class="flex shrink-0 items-center justify-between border-b border-default px-4 py-2.5">
			<h2 class="font-mono text-[10px] uppercase tracking-[0.16em] text-dimmed">
				Assistant telemetry
			</h2>
			<UButton
				color="neutral"
				variant="ghost"
				size="xs"
				label="Clear"
				@click="session.clearLogs()"
			/>
		</div>
		<div class="flex min-h-0 flex-1 flex-col gap-3.5 p-4">
			<p
				v-if="lastDescription"
				class="rounded-r-md border-l-2 border-primary bg-primary/10 px-3.5 py-2.5 text-[15px] leading-relaxed text-highlighted"
			>
				{{ lastDescription }}
			</p>
			<p
				v-else
				class="rounded-r-md border-l-2 border-default px-3.5 py-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-dimmed"
			>
				No observation yet — silence is the default
			</p>

			<div class="flex flex-col gap-1 font-mono text-[11.5px] leading-relaxed">
				<span v-if="isPlaying && nowPlayingText" class="text-primary">
					<span class="mr-1 text-[9.5px] uppercase tracking-[0.12em] text-dimmed">now</span>
					{{ nowPlayingText }}
				</span>
				<span v-else class="text-dimmed">
					<span class="mr-1 text-[9.5px] uppercase tracking-[0.12em] text-dimmed">now</span>
					nothing playing
				</span>
				<template v-if="audioQueue.length > 0">
					<span
						v-for="(item, i) in audioQueue"
						:key="i"
						class="text-dimmed"
					>
						<span class="mr-1 text-[9.5px] uppercase tracking-[0.12em] text-dimmed">
							next +{{ i + 1 }} · {{ item.priority }}
						</span>
						{{ item.text }}
					</span>
				</template>
				<span v-else class="text-dimmed">
					<span class="mr-1 text-[9.5px] uppercase tracking-[0.12em] text-dimmed">queue</span>
					empty
				</span>
			</div>

			<div
				ref="logStreamRef"
				class="mt-auto min-h-0 flex-1 overflow-y-auto border-t border-default pt-2 font-mono text-[11px] leading-[1.7]"
			>
				<div
					v-for="log in logs"
					:key="log.id"
					class="flex gap-2.5 rounded-sm px-1 hover:bg-elevated"
				>
					<span class="shrink-0 tabular-nums text-dimmed">
						{{ new Date(log.timestamp).toLocaleTimeString() }}
					</span>
					<span class="shrink-0 text-primary opacity-85">[{{ log.source }}]</span>
					<span
						class="break-words text-default"
						:class="{
							'text-error': log.level === 'error',
							'text-warning': log.level === 'warn',
						}"
					>
						{{ log.message }}
					</span>
				</div>
			</div>
		</div>
	</section>
</template>
