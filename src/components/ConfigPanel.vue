<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { storeToRefs } from "pinia";
import { useToast } from "@nuxt/ui/composables";
import {
	STT_ENGINE_OPTIONS,
	TTS_ENGINE_OPTIONS,
	useSessionStore,
} from "../stores/session";

interface EngineConfig {
	intervalMs: number;
	systemPrompt: string;
}

const session = useSessionStore();
const { isCapturing, captureInterval, serverConnected, source, ttsEngine, sttEngine } =
	storeToRefs(session);
const queryClient = useQueryClient();
const toast = useToast();

// Current server-side engine config, refreshed over REST.
const {
	data: engineConfig,
	isLoading: configLoading,
} = useQuery({
	queryKey: ["engine-config"],
	queryFn: async (): Promise<EngineConfig> => {
		const res = await fetch("/api/config");
		if (!res.ok) throw new Error(`Config request failed: ${res.status}`);
		return res.json();
	},
});

const promptDraft = shallowRef("");

// Keep the draft in sync with the server value until the operator edits it.
const draftDirty = shallowRef(false);
watch(
	() => engineConfig.value?.systemPrompt,
	(prompt) => {
		if (!draftDirty.value) promptDraft.value = prompt ?? "";
	},
	{ immediate: true },
);

const draftUnsaved = computed(
	() => promptDraft.value !== (engineConfig.value?.systemPrompt ?? ""),
);

function toggleCapture() {
	if (isCapturing.value) {
		session.stopCapture();
	} else if (source.value === "video-file") {
		session.startVideoFileCapture();
	} else {
		session.startCapture();
	}
}

function handleIntervalChange(value: number | undefined) {
	if (value === undefined) return;
	captureInterval.value = value;
	session.sendCommand("setInterval", value);
}

const {
	isPending: savePending,
	mutate: mutateSavePrompt,
} = useMutation({
	mutationFn: async () => {
		session.sendCommand("setPrompt", promptDraft.value);
		// The server applies the command asynchronously over WS; re-read
		// shortly after so the query reflects what the engine stored.
		await new Promise((resolve) => setTimeout(resolve, 300));
		return promptDraft.value;
	},
	onSuccess: async (saved) => {
		draftDirty.value = false;
		await queryClient.invalidateQueries({ queryKey: ["engine-config"] });
		toast.add({
			title: "Prompt saved",
			description:
				saved.trim() === ""
					? "System prompt override cleared — the default prompt is active."
					: "System prompt override updated.",
			color: "success",
		});
	},
});

function save() {
	if (!draftUnsaved.value) return;
	mutateSavePrompt();
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
				:label="isCapturing
					? 'Stop capture'
					: source === 'video-file'
						? 'Start sim capture'
						: 'Start capture'"
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
					:model-value="captureInterval"
					:min="1000"
					:max="10000"
					:step="500"
					:disabled="!serverConnected"
					@update:model-value="handleIntervalChange"
				/>
			</UFormField>

			<div class="flex flex-col gap-3.5">
				<UFormField
					label="TTS engine"
					class="flex flex-col gap-2"
					:ui="{ label: 'font-mono text-[10px] uppercase tracking-[0.12em] text-dimmed' }"
				>
					<USelect
						:model-value="ttsEngine"
						:items="[...TTS_ENGINE_OPTIONS]"
						:disabled="!serverConnected"
						size="sm"
						class="font-mono text-xs"
						aria-label="Text-to-speech engine"
						@update:model-value="(v: unknown) => { if (typeof v === 'string') session.setEngines('tts', v) }"
					/>
				</UFormField>

				<UFormField
					label="STT engine"
					class="flex flex-col gap-2"
					:ui="{ label: 'font-mono text-[10px] uppercase tracking-[0.12em] text-dimmed' }"
				>
					<USelect
						:model-value="sttEngine"
						:items="[...STT_ENGINE_OPTIONS]"
						:disabled="!serverConnected"
						size="sm"
						class="font-mono text-xs"
						aria-label="Speech-to-text engine"
						@update:model-value="(v: unknown) => { if (typeof v === 'string') session.setEngines('stt', v) }"
					/>
				</UFormField>
			</div>

			<UFormField
				label="System prompt override"
				class="flex flex-col gap-2"
				:ui="{ label: 'font-mono text-[10px] uppercase tracking-[0.12em] text-dimmed' }"
			>
				<template #hint>
					<UBadge
						v-if="engineConfig?.systemPrompt"
						color="warning"
						variant="subtle"
						size="sm"
					>
						Override active
					</UBadge>
				</template>
				<UTextarea
					v-model="promptDraft"
					:rows="5"
					variant="soft"
					placeholder="Leave empty for default prompt…"
					:disabled="!serverConnected || configLoading"
					class="w-full font-mono text-xs"
					@update:model-value="draftDirty = true"
				/>
				<UButton
					color="neutral"
					variant="outline"
					size="sm"
					label="Save prompt"
					:disabled="!serverConnected || !draftUnsaved"
					:loading="savePending"
					@click="save"
				/>
			</UFormField>
		</div>
	</section>
</template>
