<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { storeToRefs } from "pinia";
import { useToast } from "@nuxt/ui/composables";
import {
	GATE_ENGINE_OPTIONS,
	PIPELINE_OPTIONS,
	STT_ENGINE_OPTIONS,
	TTS_ENGINE_OPTIONS,
	useSessionStore,
} from "../stores/session";

interface EngineConfig {
	intervalMs: number;
	systemPrompt: string;
}

const session = useSessionStore();
const {
	isCapturing,
	captureInterval,
	serverConnected,
	source,
	pipeline,
	gateEngine,
	ttsEngine,
	sttEngine,
} = storeToRefs(session);
const queryClient = useQueryClient();
const toast = useToast();

// --- Local engine availability (Stage 4 seams) ---------------------------
// Proposes setup steps when a local engine is selected but not detected.

interface EngineAvailability {
	engine: string;
	available: boolean;
	detail: string;
	setupHint?: string;
}

async function fetchAvailability() {
	const res = await fetch("/api/engines/availability");
	if (!res.ok) throw new Error(`Availability check failed (${res.status})`);
	return res.json() as Promise<{ tts: EngineAvailability[]; stt: EngineAvailability[] }>;
}

const availabilityQuery = useQuery({
	queryKey: ["engines-availability"],
	queryFn: fetchAvailability,
});

function availabilityFor(
	list: EngineAvailability[] | undefined,
	engine: string,
): EngineAvailability | undefined {
	return list?.find((entry) => entry.engine === engine);
}

const ttsAvailability = computed(() => availabilityQuery.data.value?.tts);
const sttAvailability = computed(() => availabilityQuery.data.value?.stt);
const ttsStatus = computed(() => availabilityFor(ttsAvailability.value, ttsEngine.value));
const sttStatus = computed(() => availabilityFor(sttAvailability.value, sttEngine.value));

// Dropdown options get a "not detected" mark so the operator sees the state
// before selecting.
function markItems(
	options: readonly { label: string; value: string }[],
	list: EngineAvailability[] | undefined,
) {
	return options.map((option) => {
		const status = availabilityFor(list, option.value);
		return status && !status.available
			? { ...option, label: `${option.label} · not detected` }
			: option;
	});
}

const ttsItems = computed(() => markItems(TTS_ENGINE_OPTIONS, ttsAvailability.value));
const sttItems = computed(() => markItems(STT_ENGINE_OPTIONS, sttAvailability.value));

// Copyable setup commands for local engines (cloud engines only need env vars).
const SETUP_COMMANDS: Record<string, string> = {
	"piper-local": "pip install piper-tts",
	"whisper-local": [
		"git clone https://github.com/ggml-org/whisper.cpp",
		"cmake -B whisper.cpp/build -S whisper.cpp",
		"cmake --build whisper.cpp/build --target whisper-server",
		"sh whisper.cpp/models/download-ggml-model.sh base",
		"./build/bin/whisper-server -m models/ggml-base.bin --port 8080",
	].join("\n"),
};

function setupCommand(engine: string): string | undefined {
	return SETUP_COMMANDS[engine];
}

async function copySetup(kind: "tts" | "stt") {
	const engine = kind === "tts" ? ttsEngine.value : sttEngine.value;
	const command = SETUP_COMMANDS[engine];
	if (!command) return;
	try {
		await navigator.clipboard.writeText(command);
		toast.add({ title: "Setup command copied", color: "success" });
	} catch (err) {
		toast.add({
			title: "Copy failed",
			description: err instanceof Error ? err.message : String(err),
			color: "error",
		});
	}
}

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
					? "System prompt override cleared. The default prompt is active."
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
					label="Pipeline"
					class="flex flex-col gap-2"
					:ui="{ label: 'font-mono text-[10px] uppercase tracking-[0.12em] text-dimmed' }"
				>
					<USelect
						:model-value="pipeline"
						:items="[...PIPELINE_OPTIONS]"
						:disabled="!serverConnected"
						size="sm"
						class="font-mono text-xs"
						aria-label="Decision pipeline"
						@update:model-value="(v: unknown) => { if (typeof v === 'string') session.setEngines('pipeline', v) }"
					/>
				</UFormField>

				<UFormField
					v-if="pipeline === 'gated'"
					label="Gate engine"
					class="flex flex-col gap-2"
					:ui="{ label: 'font-mono text-[10px] uppercase tracking-[0.12em] text-dimmed' }"
				>
					<USelect
						:model-value="gateEngine"
						:items="[...GATE_ENGINE_OPTIONS]"
						:disabled="!serverConnected"
						size="sm"
						class="font-mono text-xs"
						aria-label="Gate engine"
						@update:model-value="(v: unknown) => { if (typeof v === 'string') session.setEngines('gate', v) }"
					/>
				</UFormField>

				<UFormField
					label="TTS engine"
					class="flex flex-col gap-2"
					:ui="{ label: 'font-mono text-[10px] uppercase tracking-[0.12em] text-dimmed' }"
				>
					<USelect
						:model-value="ttsEngine"
						:items="ttsItems"
						:disabled="!serverConnected"
						size="sm"
						class="font-mono text-xs"
						aria-label="Text-to-speech engine"
						@update:model-value="(v: unknown) => { if (typeof v === 'string') session.setEngines('tts', v) }"
					/>
					<p
						v-if="ttsStatus"
						class="font-mono text-[10px]"
						:class="ttsStatus.available ? 'text-success/80' : 'text-warning'"
					>
						{{ ttsStatus.available ? "✓ ready" : "✗ not detected" }}
					</p>
					<div
						v-if="ttsStatus && !ttsStatus.available"
						class="rounded-md border border-warning/40 bg-warning/5 p-2.5"
					>
						<p class="text-[11.5px] leading-relaxed text-muted">
							{{ ttsStatus.detail }}<span v-if="ttsStatus.setupHint">. {{ ttsStatus.setupHint }}</span>
						</p>
						<div v-if="setupCommand(ttsEngine)" class="mt-2 flex items-center gap-2">
							<pre class="min-w-0 flex-1 overflow-x-auto rounded-sm bg-elevated px-2 py-1.5 font-mono text-[10.5px] text-highlighted">{{ setupCommand(ttsEngine) }}</pre>
							<UButton
								icon="i-lucide-copy"
								size="xs"
								color="neutral"
								variant="soft"
								aria-label="Copy TTS setup command"
								@click="copySetup('tts')"
							/>
						</div>
					</div>
				</UFormField>

				<UFormField
					label="STT engine"
					class="flex flex-col gap-2"
					:ui="{ label: 'font-mono text-[10px] uppercase tracking-[0.12em] text-dimmed' }"
				>
					<USelect
						:model-value="sttEngine"
						:items="sttItems"
						:disabled="!serverConnected"
						size="sm"
						class="font-mono text-xs"
						aria-label="Speech-to-text engine"
						@update:model-value="(v: unknown) => { if (typeof v === 'string') session.setEngines('stt', v) }"
					/>
					<p
						v-if="sttStatus"
						class="font-mono text-[10px]"
						:class="sttStatus.available ? 'text-success/80' : 'text-warning'"
					>
						{{ sttStatus.available ? "✓ ready" : "✗ not detected" }}
					</p>
					<div
						v-if="sttStatus && !sttStatus.available"
						class="rounded-md border border-warning/40 bg-warning/5 p-2.5"
					>
						<p class="text-[11.5px] leading-relaxed text-muted">
							{{ sttStatus.detail }}<span v-if="sttStatus.setupHint">. {{ sttStatus.setupHint }}</span>
						</p>
						<div v-if="setupCommand(sttEngine)" class="mt-2 flex flex-col gap-1.5">
							<pre class="overflow-x-auto rounded-sm bg-elevated px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-highlighted">{{ setupCommand(sttEngine) }}</pre>
							<UButton
								icon="i-lucide-copy"
								size="xs"
								color="neutral"
								variant="soft"
								label="Copy setup commands"
								block
								@click="copySetup('stt')"
							/>
						</div>
					</div>
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
