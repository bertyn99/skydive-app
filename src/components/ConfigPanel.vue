<script setup lang="ts">
import { shallowRef } from "vue";
import { storeToRefs } from "pinia";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
const { isCapturing, captureInterval, serverConnected } = storeToRefs(session);

const promptDraft = shallowRef("");

function toggleCapture() {
	if (isCapturing.value) {
		session.stopCapture();
	} else {
		session.startCapture();
	}
}

function handleIntervalChange(value: number | undefined) {
	if (value === undefined) return;
	captureInterval.value = value;
	session.sendCommand("setInterval", value);
}
</script>

<template>
	<section class="flex min-h-0 min-w-0 flex-col overflow-y-auto bg-default" aria-label="Session controls">
		<div class="flex shrink-0 items-center justify-between border-b border-default px-4 py-2.5">
			<h2 class="font-mono text-[10px] uppercase tracking-[0.16em] text-dimmed">
				Session
			</h2>
			<UBadge
				:color="serverConnected ? 'success' : 'error'"
				variant="subtle"
				size="sm"
			>
				{{ serverConnected ? "ready" : "no link" }}
			</UBadge>
		</div>
		<div class="flex flex-1 flex-col gap-5 p-4">
			<UButton
				block
				:color="isCapturing ? 'error' : 'primary'"
				variant="subtle"
				:disabled="!serverConnected"
				:label="isCapturing ? 'Stop capture' : 'Start capture'"
				@click="toggleCapture"
			/>

			<UFormField
				label="Clip interval"
				class="flex flex-col gap-2"
				:ui="{ label: 'font-mono text-[10px] uppercase tracking-[0.12em] text-dimmed' }"
			>
				<template #hint>
					<span class="font-mono text-[10px] tracking-[0.05em] text-primary">
						{{ captureInterval }}ms
					</span>
				</template>
				<USlider
					v-model="captureInterval"
					:min="1000"
					:max="10000"
					:step="500"
					:disabled="!serverConnected"
					@update:model-value="handleIntervalChange"
				/>
			</UFormField>

			<UFormField
				label="System prompt override"
				class="flex flex-col gap-2"
				:ui="{ label: 'font-mono text-[10px] uppercase tracking-[0.12em] text-dimmed' }"
			>
				<UTextarea
					v-model="promptDraft"
					:rows="5"
					variant="soft"
					placeholder="Leave empty for default prompt…"
					:disabled="!serverConnected"
					class="w-full font-mono text-xs"
				/>
				<UButton
					color="neutral"
					variant="outline"
					size="sm"
					label="Save prompt"
					:disabled="!serverConnected"
					@click="session.sendCommand('setPrompt', promptDraft)"
				/>
			</UFormField>
		</div>
	</section>
</template>
