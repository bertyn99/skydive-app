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
	<section class="panel rail-panel" aria-label="Session controls">
		<div class="panel-head">
			<h2 class="panel-title">Session</h2>
			<span class="panel-meta">{{ serverConnected ? "ready" : "no link" }}</span>
		</div>
		<div class="panel-body">
			<div class="field-group">
				<UButton
					block
					:color="isCapturing ? 'error' : 'primary'"
					variant="subtle"
					:disabled="!serverConnected"
					:label="isCapturing ? 'Stop capture' : 'Start capture'"
					@click="toggleCapture"
				/>
			</div>

			<div class="field-group">
				<label class="field-label" for="capture-interval">
					Clip interval
					<span class="value">{{ captureInterval }}ms</span>
				</label>
				<USlider
					id="capture-interval"
					:model-value="captureInterval"
					:min="1000"
					:max="10000"
					:step="500"
					:disabled="!serverConnected"
					@update:model-value="handleIntervalChange"
				/>
			</div>

			<div class="field-group">
				<label class="field-label" for="system-prompt">
					System prompt override
				</label>
				<UTextarea
					id="system-prompt"
					v-model="promptDraft"
					:rows="5"
					variant="soft"
					placeholder="Leave empty for default prompt…"
					:disabled="!serverConnected"
					class="w-full"
				/>
				<UButton
					color="neutral"
					variant="outline"
					label="Save prompt"
					:disabled="!serverConnected"
					@click="session.sendCommand('setPrompt', promptDraft)"
				/>
			</div>
		</div>
	</section>
</template>
