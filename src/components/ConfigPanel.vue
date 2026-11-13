<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { storeToRefs } from "pinia";
import { useToast } from "@nuxt/ui/composables";
import {
	COMPOSER_ENGINE_OPTIONS,
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
	composerEngine,
	profile,
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
	return res.json() as Promise<{
		tts: EngineAvailability[];
		stt: EngineAvailability[];
		composer: EngineAvailability[];
	}>;
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
const composerAvailability = computed(() => availabilityQuery.data.value?.composer);
const ttsStatus = computed(() => availabilityFor(ttsAvailability.value, ttsEngine.value));
const sttStatus = computed(() => availabilityFor(sttAvailability.value, sttEngine.value));
const composerStatus = computed(() =>
	availabilityFor(composerAvailability.value, composerEngine.value),
);

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
const composerItems = computed(() =>
	markItems(COMPOSER_ENGINE_OPTIONS, composerAvailability.value),
);

// Copyable setup commands for local engines (cloud engines only need env vars).
const SETUP_COMMANDS: Record<string, string> = {
	// piper-local auto-installs (binary + voice) on first use via voipi.
	"piper-local": "PIPER_VOICE=fr_FR-mls-medium  # optional override — auto-installs on first use",
	// The whisper setup card below installs the model and starts the server;
	// only the binary still needs a one-time local build.
	"whisper-local": "pnpm setup:whisper",
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

// --- Whisper local model manager (STT) -------------------------------------
// Hex-style local model pipeline: pinned HF catalog, download with progress,
// start/stop the whisper.cpp sidecar — all from the dashboard.

interface WhisperModelSpecPayload {
	id: string;
	label: string;
	kind: "ggml" | "system";
	platform?: "darwin" | "linux" | "win32";
	languages: string[];
	languagesNote: string;
	selfDetecting?: boolean;
	diskNote: string;
	ramNote: string;
	note: string;
	hexNote?: string;
}

interface WhisperModelReportPayload {
	spec: WhisperModelSpecPayload;
	status: "missing" | "partial" | "downloading" | "found" | "verified" | "corrupt" | "system";
	supported: boolean;
	receivedBytes?: number;
	filePath?: string;
	foundPath?: string;
	error?: string;
	partialBytes?: number;
}

interface WhisperSetupPayload {
	modelsDir: string;
	platform: string;
	language: string;
	recommendedId: string;
	activeRunner: { runner: "parakeet-cli" | "whisper-server"; modelId: string } | null;
	binary: { available: boolean; path?: string; detail: string; setupHint?: string };
	ffmpeg: { available: boolean; detail: string };
	server: { running: boolean; responding: boolean; pid?: number; modelId?: string; port: number; detail: string };
	models: WhisperModelReportPayload[];
	install: { modelId: string; status: string; receivedBytes: number; totalBytes: number; error?: string } | null;
	lastInstallError: { modelId: string; error: string } | null;
}

async function postJson(url: string, body?: unknown): Promise<unknown> {
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const payload = (await res.json().catch(() => null)) as { statusMessage?: string; message?: string } | null;
	if (!res.ok) {
		const detail = payload?.statusMessage ?? payload?.message ?? `HTTP ${res.status}`;
		throw new Error(detail);
	}
	return payload;
}

async function fetchWhisperSetup(): Promise<WhisperSetupPayload> {
	const res = await fetch("/api/engines/whisper-setup");
	if (!res.ok) throw new Error(`Whisper setup check failed (${res.status})`);
	return res.json() as Promise<WhisperSetupPayload>;
}

const whisperSetupQuery = useQuery({
	queryKey: ["whisper-setup"],
	queryFn: fetchWhisperSetup,
	// Poll once per second while a model download is running, then stop.
	refetchInterval: (query) =>
		(query.state.data as WhisperSetupPayload | undefined)?.install?.status === "downloading"
			? 1000
			: false,
});

const whisperSetup = computed(() => whisperSetupQuery.data.value);
const installBusy = computed(() => whisperSetup.value?.install?.status === "downloading");

/** Models that apply to this platform (Apple Speech only on macOS, like Hex). */
const platformModels = computed(() =>
	(whisperSetup.value?.models ?? []).filter(
		(model) => !model.spec.platform || model.spec.platform === whisperSetup.value?.platform,
	),
);

function isLanguagePick(model: WhisperModelReportPayload): boolean {
	return whisperSetup.value?.recommendedId === model.spec.id;
}

function formatMb(bytes: number): string {
	return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function downloadPct(): string {
	const total = whisperSetup.value?.install?.totalBytes ?? 0;
	if (!total) return "0";
	const pct = Math.floor(((whisperSetup.value?.install?.receivedBytes ?? 0) / total) * 100);
	return String(Math.min(100, Math.max(0, pct)));
}

const canStartServer = computed(() => {
	const setup = whisperSetup.value;
	if (!setup || !setup.binary.available || installBusy.value) return false;
	if (setup.server.running || setup.server.responding) return false;
	return setup.models.some((model) => model.status === "verified" || model.status === "found");
});

function invalidateVoiceQueries() {
	void queryClient.invalidateQueries({ queryKey: ["whisper-setup"] });
	void queryClient.invalidateQueries({ queryKey: ["engines-availability"] });
}

function whisperActionError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

const {
	mutate: mutateInstallModel,
} = useMutation({
	mutationFn: (modelId: string) => postJson("/api/engines/whisper-setup/install-model", { modelId }),
	onSuccess: () => invalidateVoiceQueries(),
	onError: (err) => {
		toast.add({ title: "Whisper install failed", description: whisperActionError(err), color: "error" });
		invalidateVoiceQueries();
	},
});

const {
	mutate: mutateRemoveModel,
} = useMutation({
	mutationFn: (modelId: string) => postJson("/api/engines/whisper-setup/remove-model", { modelId }),
	onSuccess: () => invalidateVoiceQueries(),
	onError: (err) => {
		toast.add({ title: "Whisper model removal failed", description: whisperActionError(err), color: "error" });
	},
});

const {
	isPending: startServerPending,
	mutate: mutateStartServer,
} = useMutation({
	mutationFn: () => postJson("/api/engines/whisper-setup/start-server"),
	onSuccess: () => {
		toast.add({ title: "Whisper server running", color: "success" });
		invalidateVoiceQueries();
	},
	onError: (err) => {
		toast.add({ title: "Whisper server failed to start", description: whisperActionError(err), color: "error" });
	},
});

const {
	mutate: mutateStopServer,
} = useMutation({
	mutationFn: () => postJson("/api/engines/whisper-setup/stop-server"),
	onSuccess: () => invalidateVoiceQueries(),
	onError: (err) => {
		toast.add({ title: "Whisper server stop failed", description: whisperActionError(err), color: "error" });
	},
});

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
				<div class="flex items-center justify-between">
					<span class="font-mono text-[10px] uppercase tracking-[0.12em] text-dimmed">
						Profile
					</span>
					<UBadge
						:color="profile === 'offline' ? 'success' : profile === 'cloud' ? 'info' : 'neutral'"
						variant="subtle"
						size="sm"
						class="font-mono uppercase"
					>
						{{ profile }}
					</UBadge>
				</div>
				<UFieldGroup size="xs">
					<UButton
						label="Offline"
						icon="i-lucide-wifi-off"
						:color="profile === 'offline' ? 'primary' : 'neutral'"
						:variant="profile === 'offline' ? 'subtle' : 'soft'"
						:disabled="!serverConnected"
						block
						@click="session.setProfile('offline')"
					/>
					<UButton
						label="Cloud"
						icon="i-lucide-cloud"
						:color="profile === 'cloud' ? 'info' : 'neutral'"
						:variant="profile === 'cloud' ? 'subtle' : 'soft'"
						:disabled="!serverConnected"
						block
						@click="session.setProfile('cloud')"
					/>
				</UFieldGroup>

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
					v-if="pipeline === 'gated'"
					label="Composer engine"
					class="flex flex-col gap-2"
					:ui="{ label: 'font-mono text-[10px] uppercase tracking-[0.12em] text-dimmed' }"
				>
					<USelect
						:model-value="composerEngine"
						:items="composerItems"
						:disabled="!serverConnected"
						size="sm"
						class="font-mono text-xs"
						aria-label="Composer engine"
						@update:model-value="(v: unknown) => { if (typeof v === 'string') session.setEngines('composer', v) }"
					/>
					<p
						v-if="composerStatus"
						class="font-mono text-[10px]"
						:class="composerStatus.available ? 'text-success/80' : 'text-warning'"
					>
						{{ composerStatus.available ? "✓ ready" : "✗ not detected" }}
					</p>
					<div
						v-if="composerStatus && !composerStatus.available && composerStatus.setupHint"
						class="rounded-md border border-warning/40 bg-warning/5 p-2.5"
					>
						<p class="text-[11.5px] leading-relaxed text-muted">
							{{ composerStatus.detail }}. {{ composerStatus.setupHint }}
						</p>
					</div>
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

				<!-- Whisper local model manager: pinned HF catalog + sidecar control
					(Hex-style first-run experience, in the dashboard instead of the app). -->
				<div
					v-if="sttEngine === 'whisper-local' && whisperSetup"
					class="rounded-md border border-default bg-elevated/40 p-3"
				>
					<div class="flex items-center justify-between gap-2">
						<span class="font-mono text-[10px] uppercase tracking-[0.12em] text-dimmed">Whisper local · models</span>
						<div class="flex items-center gap-1.5">
							<UBadge
								v-if="whisperSetup.language"
								color="info"
								variant="subtle"
								size="sm"
							>
								listening in {{ whisperSetup.language }}
							</UBadge>
							<UBadge
								:color="whisperSetup.server.running ? 'success' : 'neutral'"
								variant="subtle"
								size="sm"
							>
								{{ whisperSetup.server.running ? "server up" : "server down" }}
							</UBadge>
						</div>
					</div>

					<div class="mt-2 flex flex-col gap-0.5 font-mono text-[10.5px]">
						<p
							v-if="whisperSetup.activeRunner"
							class="text-primary/80"
						>
							→ {{ whisperSetup.activeRunner.runner }} on {{ whisperSetup.activeRunner.modelId }}
						</p>
						<p :class="whisperSetup.binary.available ? 'text-success/80' : 'text-warning'">
							{{ whisperSetup.binary.available ? "✓" : "✗" }} {{ whisperSetup.binary.detail }}
						</p>
						<p v-if="!whisperSetup.binary.available" class="text-muted">
							{{ whisperSetup.binary.setupHint }}
						</p>
						<p :class="whisperSetup.ffmpeg.available ? 'text-success/80' : 'text-warning'">
							{{ whisperSetup.ffmpeg.available ? "✓" : "✗" }} {{ whisperSetup.ffmpeg.detail }}
						</p>
					</div>

					<div v-if="!whisperSetup.binary.available" class="mt-2 flex items-center gap-2">
						<pre class="min-w-0 flex-1 overflow-x-auto rounded-sm bg-elevated px-2 py-1.5 font-mono text-[10.5px] text-highlighted">{{ setupCommand("whisper-local") }}</pre>
						<UButton
							icon="i-lucide-copy"
							size="xs"
							color="neutral"
							variant="soft"
							aria-label="Copy whisper build command"
							@click="copySetup('stt')"
						/>
					</div>

					<div class="mt-2.5 flex flex-col gap-0.5">
						<div
							v-for="model in platformModels"
							:key="model.spec.id"
							class="flex items-center justify-between gap-2 rounded-sm px-1.5 py-1 hover:bg-elevated"
						>
							<div class="min-w-0">
								<p class="truncate text-[11.5px] text-highlighted">
									{{ model.spec.label }}
									<span
										v-if="isLanguagePick(model)"
										class="ml-1.5 font-mono text-[9.5px] text-primary"
										title="Hex adapts the recommended model to the listening language"
									>recommended for {{ whisperSetup.language }}</span>
									<span
										v-if="model.spec.selfDetecting"
										class="ml-1.5 font-mono text-[9.5px] text-dimmed"
										title="The model detects the spoken language itself — no hint needed"
									>· auto-detect</span>
									<UBadge
										v-if="model.status === 'downloading'"
										color="warning"
										variant="subtle"
										size="sm"
									>
										{{ downloadPct() }}%
									</UBadge>
								</p>
								<p class="truncate font-mono text-[10px] text-dimmed">
									{{ model.spec.languagesNote }} · {{ model.spec.diskNote }} · {{ model.spec.ramNote }} · {{ model.spec.note }}
									<span v-if="model.status === 'found'"> · found in HF cache</span>
									<span v-else-if="model.status === 'system'"> · system engine</span>
									<span v-else-if="model.status === 'corrupt'" class="text-warning"> · {{ model.error }}</span>
									<span v-else-if="model.status === 'partial'" class="text-muted"> · {{ formatMb(model.partialBytes ?? 0) }} partial</span>
								</p>
							</div>
							<UButton
								v-if="model.status === 'missing' || model.status === 'partial' || model.status === 'corrupt'"
								size="xs"
								color="neutral"
								variant="soft"
								label="Install"
								:disabled="installBusy"
								@click="mutateInstallModel(model.spec.id)"
							/>
							<UButton
								v-else-if="model.status === 'verified'"
								size="xs"
								color="neutral"
								variant="ghost"
								label="Remove"
								@click="mutateRemoveModel(model.spec.id)"
							/>
						</div>
					</div>

					<div class="mt-2.5 flex items-center gap-2">
						<UButton
							size="xs"
							color="primary"
							variant="soft"
							label="Start server"
							:disabled="!canStartServer"
							:loading="startServerPending"
							@click="mutateStartServer()"
						/>
						<UButton
							v-if="whisperSetup.server.running"
							size="xs"
							color="neutral"
							variant="ghost"
							label="Stop"
							@click="mutateStopServer()"
						/>
						<p class="min-w-0 flex-1 truncate font-mono text-[10px] text-dimmed">{{ whisperSetup.server.detail }}</p>
					</div>
					<p
						v-if="whisperSetup.lastInstallError"
						class="mt-1 truncate font-mono text-[10px] text-warning"
					>
						last install error · {{ whisperSetup.lastInstallError.modelId }}: {{ whisperSetup.lastInstallError.error }}
					</p>
				</div>
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
