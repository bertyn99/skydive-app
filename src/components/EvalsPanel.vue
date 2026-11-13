<script setup lang="ts">
import { computed, shallowRef } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { EvalRun, SituationDefinition } from "../../server/utils/evals";

async function fetchSituations(): Promise<SituationDefinition[]> {
	const res = await fetch("/api/situations");
	if (!res.ok) throw new Error(`Failed to load situations (${res.status})`);
	return res.json();
}

async function fetchRuns(): Promise<EvalRun[]> {
	const res = await fetch("/api/evals/runs");
	if (!res.ok) throw new Error(`Failed to load runs (${res.status})`);
	return res.json();
}

const queryClient = useQueryClient();

const situationsQuery = useQuery({
	queryKey: ["situations"],
	queryFn: fetchSituations,
});
const runsQuery = useQuery({
	queryKey: ["eval-runs"],
	queryFn: fetchRuns,
	// Poll while a run is in flight, stop when idle.
	refetchInterval: (query) =>
		query.state.data?.some((run) => run.status === "running") ? 1500 : false,
});

const situations = computed(() => situationsQuery.data.value ?? []);
const runs = computed(() => runsQuery.data.value ?? []);
const latestRun = computed(() => runs.value[0] ?? null);
const isRunning = computed(() => latestRun.value?.status === "running");

const startRun = useMutation({
	mutationFn: async (judge: boolean): Promise<{ runId: string }> => {
		const res = await fetch("/api/evals/run", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ judge }),
		});
		if (!res.ok) {
			const payload = (await res.json().catch(() => ({}))) as { statusMessage?: string };
			throw new Error(payload.statusMessage ?? `Run failed (${res.status})`);
		}
		return res.json();
	},
	onSuccess: () => {
		void queryClient.invalidateQueries({ queryKey: ["eval-runs"] });
	},
});
const starting = computed(() => startRun.isPending.value);

// LLM-as-judge: a second model pass grades each behavior on the same clip.
const judgeEnabled = shallowRef(true);

const setVerdict = useMutation({
	mutationFn: async (input: {
		runId: string;
		situationId: string;
		humanVerdict: "agree" | "override";
	}): Promise<unknown> => {
		const res = await fetch("/api/evals/verdict", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(input),
		});
		if (!res.ok) throw new Error(`Verdict failed (${res.status})`);
		return res.json();
	},
	onSuccess: () => {
		void queryClient.invalidateQueries({ queryKey: ["eval-runs"] });
	},
});
const savingVerdict = computed(() => setVerdict.isPending.value);

// Fixture preview: clicking a situation chip loads its clip inline.
const previewId = shallowRef<string | null>(null);

function togglePreview(id: string): void {
	previewId.value = previewId.value === id ? null : id;
}

function passedChecks(run: EvalRun): number {
	return run.results.filter((result) => result.passed).length;
}

function formatTime(timestamp: number): string {
	return new Date(timestamp).toLocaleTimeString("en-US", { hour12: false });
}

function formatDate(timestamp: number): string {
	return new Date(timestamp).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
	});
}
</script>

<template>
	<section class="flex min-h-0 min-w-0 flex-col bg-default" aria-label="Evals">
		<div class="flex shrink-0 items-center justify-between border-b border-default px-4 py-2.5">
			<h2 class="font-mono text-[10px] uppercase tracking-[0.16em] text-dimmed">
				Evals · Situations
			</h2>
			<div class="flex items-center gap-2">
				<UBadge
					v-if="latestRun"
					:color="isRunning ? 'warning' : passedChecks(latestRun) === latestRun.summary.total ? 'success' : 'error'"
					variant="subtle"
					size="sm"
					class="font-mono tabular-nums"
				>
					{{ isRunning
						? `Running ${latestRun.results.length}/${latestRun.summary.total}`
						: `${passedChecks(latestRun)}/${latestRun.summary.total} passed` }}
				</UBadge>
				<UCheckbox
					v-model="judgeEnabled"
					label="LLM judge"
					size="xs"
					class="font-mono text-[10.5px] text-muted"
				/>
				<UButton
					size="xs"
					:color="isRunning ? 'neutral' : 'primary'"
					variant="subtle"
					:label="isRunning ? 'Running…' : 'Run suite'"
					icon="i-lucide-play"
					:loading="starting"
					:disabled="isRunning"
					@click="startRun.mutate(judgeEnabled)"
				/>
			</div>
		</div>

		<div class="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4 max-h-[520px]">
			<!-- Fixture inventory: chips + inline clip preview -->
			<div v-if="situations.length > 0" class="flex flex-col gap-2">
				<div class="flex flex-wrap gap-1.5">
					<UButton
						v-for="situation in situations"
						:key="situation.id"
						size="xs"
						:color="previewId === situation.id ? 'primary' : 'neutral'"
						variant="soft"
						:label="situation.id"
						@click="togglePreview(situation.id)"
					/>
				</div>
				<div
					v-for="situation in situations.filter((s) => s.id === previewId)"
					:key="situation.id"
					class="flex flex-col gap-1.5 rounded-md border border-default bg-elevated p-3"
				>
					<div class="flex flex-wrap items-center gap-1.5">
						<UBadge
							:color="situation.expectation === 'speak' ? 'primary' : 'neutral'"
							variant="subtle"
							size="sm"
							class="font-mono uppercase"
						>
							{{ situation.expectation }}
						</UBadge>
						<UBadge
							v-if="situation.repeat"
							color="warning"
							variant="subtle"
							size="sm"
							class="font-mono uppercase"
						>
							repeat → {{ situation.repeat.expectation }}
						</UBadge>
						<span v-if="situation.relevanceBand" class="font-mono text-[10.5px] tabular-nums text-dimmed">
							band [{{ situation.relevanceBand[0] }}, {{ situation.relevanceBand[1] }}]
						</span>
					</div>
					<p class="text-[12.5px] leading-relaxed text-muted">{{ situation.description }}</p>
					<video
						v-if="previewId === situation.id"
						:src="`/api/situations/${situation.id}/clip`"
						controls
						preload="none"
						playsinline
						class="max-h-56 w-full rounded-sm border border-default bg-black object-contain"
					/>
				</div>
			</div>
			<p v-else class="text-[12.5px] text-dimmed">
				{{ situationsQuery.error.value?.message ?? "No situation fixtures in situations/" }}
			</p>

			<!-- Latest run: per-Situation results -->
			<div v-if="latestRun" class="flex flex-col gap-2">
				<div class="flex items-center justify-between border-t border-default pt-2">
					<span class="font-mono text-[10px] uppercase tracking-[0.12em] text-dimmed">
						Latest run · {{ formatDate(latestRun.startedAt) }} {{ formatTime(latestRun.startedAt) }}
					</span>
					<span class="font-mono text-[10px] tracking-[0.05em] text-dimmed">
						{{ latestRun.engine }}
					</span>
				</div>

				<div
					v-for="result in latestRun.results"
					:key="result.situationId"
					class="flex flex-col gap-2 rounded-md border p-3"
					:class="result.passed ? 'border-default bg-elevated' : 'border-error/40 bg-error/5'"
				>
					<div class="flex items-center justify-between gap-2">
						<div class="flex items-center gap-1.5">
							<UBadge
								:color="result.passed ? 'success' : 'error'"
								variant="subtle"
								size="sm"
								class="font-mono"
							>
								{{ result.passed ? "PASS" : "FAIL" }}
							</UBadge>
							<span class="font-mono text-[11.5px] text-highlighted">{{ result.situationId }}</span>
						</div>
						<div class="flex items-center gap-1.5">
							<UBadge
								v-if="result.humanVerdict"
								:color="result.humanVerdict === 'agree' ? 'info' : 'warning'"
								variant="outline"
								size="sm"
								class="font-mono uppercase"
							>
								human · {{ result.humanVerdict }}
							</UBadge>
							<UFieldGroup v-else size="xs">
								<UButton
									label="Agree"
									color="neutral"
									variant="soft"
									:loading="savingVerdict"
									@click="setVerdict.mutate({ runId: latestRun.id, situationId: result.situationId, humanVerdict: 'agree' })"
								/>
								<UButton
									label="Override"
									color="warning"
									variant="soft"
									:loading="savingVerdict"
									@click="setVerdict.mutate({ runId: latestRun.id, situationId: result.situationId, humanVerdict: 'override' })"
								/>
							</UFieldGroup>
						</div>
					</div>

					<!-- Watch what the assistant saw, then judge the verdict -->
					<video
						:src="`/api/situations/${result.situationId}/clip`"
						controls
						preload="none"
						playsinline
						class="max-h-40 w-full rounded-sm border border-default bg-black object-contain"
					/>

					<div
						v-for="pass in result.passes"
						:key="pass.pass"
						class="flex flex-col gap-1 border-l-2 pl-2.5"
						:class="pass.verdict === 'pass' ? 'border-success/50' : 'border-error/60'"
					>
						<div class="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-[10.5px] tabular-nums text-dimmed">
							<span class="uppercase tracking-[0.1em]">view {{ pass.pass }} · {{ pass.expectation }}</span>
							<span :class="pass.spoken ? 'text-primary' : 'text-muted'">
								{{ pass.spoken ? "SPOKE" : "SILENCE" }}
							</span>
							<span>rel {{ pass.relevance }}/10</span>
							<span>{{ pass.latencyMs }}ms</span>
							<span v-if="pass.actions.length > 0" class="text-warning">
								actions: {{ pass.actions.join(", ") }}
							</span>
						</div>

						<!-- Checks grouped by pipeline tier -->
						<div
							v-for="tier in (['decision', 'composer'] as const)"
							:key="tier"
							class="flex flex-wrap items-center gap-1.5 font-mono text-[10px]"
						>
							<span class="uppercase tracking-[0.12em] text-dimmed">{{ tier }}</span>
							<span
								v-for="check in pass.checks.filter((c) => c.tier === tier)"
								:key="check.name"
								:title="check.detail"
								:class="check.passed ? 'text-success/80' : 'text-error'"
							>
								{{ check.passed ? "✓" : "✗" }} {{ check.name }}
							</span>
						</div>

						<!-- LLM-as-judge rubric verdict (informative, never flips PASS/FAIL) -->
						<div v-if="pass.judge" class="flex items-center gap-1.5 font-mono text-[10.5px]">
							<UBadge
								:color="pass.judge.correct ? 'success' : 'warning'"
								variant="outline"
								size="sm"
								class="tabular-nums"
								:title="pass.judge.reason"
							>
								judge {{ (pass.judge.score * 100).toFixed(0) }}%
							</UBadge>
							<span class="truncate text-muted" :title="pass.judge.reason">{{ pass.judge.reason }}</span>
						</div>
						<span v-else-if="pass.judgeError" class="font-mono text-[10.5px] text-dimmed" :title="pass.judgeError">
							judge unavailable
						</span>

						<p v-if="pass.error" class="text-[12px] text-error">{{ pass.error }}</p>
						<p
							v-else-if="pass.observation && pass.spoken"
							class="text-[13px] leading-relaxed text-highlighted"
						>
							« {{ pass.observation }} »
						</p>
					</div>
					<p v-if="result.humanNote" class="text-[12px] italic text-muted">{{ result.humanNote }}</p>
				</div>
			</div>

			<UEmpty
				v-else
				icon="i-lucide-flask-conical"
				title="No eval runs yet"
				description="Run the suite to score every Situation through the real pipeline."
				class="py-6 text-muted"
			/>

			<!-- Drift: pass rate across runs -->
			<div v-if="runs.length > 1" class="flex flex-col gap-1 border-t border-default pt-2">
				<h4 class="font-mono text-[10px] uppercase tracking-[0.12em] text-dimmed">
					Drift · last {{ Math.min(runs.length, 8) }} runs
				</h4>
				<div
					v-for="run in runs.slice(0, 8)"
					:key="run.id"
					class="flex items-center justify-between font-mono text-[10.5px] tabular-nums"
				>
					<span class="text-muted">
						{{ formatDate(run.startedAt) }} {{ formatTime(run.startedAt) }}
					</span>
					<div class="flex items-center gap-2">
						<span :class="run.summary.failed === 0 && run.status === 'done' ? 'text-success' : 'text-warning'">
							{{ run.summary.passed }}/{{ run.summary.total }}
						</span>
						<span class="text-dimmed">{{ run.status }}</span>
					</div>
				</div>
			</div>

			<p v-if="startRun.error.value" class="text-[12px] text-error">
				{{ startRun.error.value.message }}
			</p>
		</div>
	</section>
</template>
