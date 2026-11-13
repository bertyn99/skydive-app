<script setup lang="ts">
import { computed, shallowRef } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type {
	EvalRun,
	SituationDefinition,
	SituationResult,
} from "../../server/utils/evals";
import {
	MATRIX_ENGINES,
	type MatrixEngineId,
} from "../../shared/eval-engines";

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

// --- Matrix engine selection (Stage 5) ------------------------------------
const selectedEngines = shallowRef<MatrixEngineId[]>([
	"fused",
	"gate:gemini",
	"gate:rules",
]);

function toggleEngine(id: MatrixEngineId): void {
	const current = selectedEngines.value;
	selectedEngines.value = current.includes(id)
		? current.filter((engine) => engine !== id)
		: [...current, id];
}

const startRun = useMutation({
	mutationFn: async (input: {
		judge: boolean;
		engines: MatrixEngineId[];
	}): Promise<{ runId: string }> => {
		const res = await fetch("/api/evals/run", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(input),
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
		engine: string;
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

function passedChecks(run: EvalRun): number {
	return run.results.filter((result) => result.passed).length;
}

/** Results of the latest run grouped per matrix engine. */
const resultsByEngine = computed(() => {
	const grouped = new Map<MatrixEngineId, SituationResult[]>();
	for (const entry of latestRun.value?.results ?? []) {
		const engine = entry.engine ?? "fused";
		const list = grouped.get(engine) ?? [];
		list.push(entry);
		grouped.set(engine, list);
	}
	return grouped;
});

const matrixEngines = computed<MatrixEngineId[]>(
	() => latestRun.value?.engines ?? ["fused"],
);

/** Matrix cell: pass/fail for one (situation, engine) pair. */
function matrixCell(situationId: string, engine: MatrixEngineId) {
	const entry = resultsByEngine.value
		.get(engine)
		?.find((result) => result.situationId === situationId);
	if (!entry) return "missing" as const;
	return entry.passed ? ("pass" as const) : ("fail" as const);
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
	<UDashboardPanel id="evals">
		<template #header>
			<UDashboardNavbar>
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>

				<template #title>
					<span class="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
						Evals
					</span>
				</template>

				<template #right>
					<div class="flex items-center gap-2.5">
						<UBadge
							v-if="latestRun"
							:color="isRunning
								? 'warning'
								: passedChecks(latestRun) === latestRun.summary.total
									? 'success'
									: 'error'"
							variant="subtle"
							size="sm"
							class="font-mono tabular-nums"
						>
							{{ isRunning
								? `${latestRun.results.length}/${latestRun.summary.total}`
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
							:disabled="isRunning || selectedEngines.length === 0"
							@click="startRun.mutate({ judge: judgeEnabled, engines: selectedEngines })"
						/>
					</div>
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<div class="mx-auto flex w-full max-w-[1400px] flex-col gap-8">
				<p
					v-if="startRun.error.value"
					class="rounded-md border border-error/40 bg-error/10 px-3.5 py-2.5 text-[13px] text-error"
				>
					{{ startRun.error.value.message }}
				</p>

				<!-- Matrix engine selection -->
				<section class="flex flex-col gap-2" aria-label="Matrix engines">
					<h2 class="font-mono text-[10px] uppercase tracking-[0.16em] text-dimmed">
						Engines under test
					</h2>
					<div class="flex flex-wrap items-center gap-x-5 gap-y-2">
						<UCheckbox
							v-for="engine in MATRIX_ENGINES"
							:key="engine.id"
							:model-value="selectedEngines.includes(engine.id)"
							:label="engine.label"
							size="xs"
							class="font-mono text-[10.5px] text-muted"
							@update:model-value="() => toggleEngine(engine.id)"
						/>
					</div>
				</section>

				<!-- Fixtures: what the assistant can be tested against -->
				<section class="flex flex-col gap-3" aria-label="Situations">
					<h2 class="font-mono text-[10px] uppercase tracking-[0.16em] text-dimmed">
						Situations
					</h2>
					<div v-if="situations.length > 0" class="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
						<div
							v-for="situation in situations"
							:key="situation.id"
							class="flex flex-col gap-2 rounded-md border border-default bg-elevated p-3"
						>
							<div class="flex flex-wrap items-center gap-1.5">
								<span class="font-mono text-[11.5px] text-highlighted">{{ situation.id }}</span>
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
								<span
									v-if="situation.relevanceBand"
									class="font-mono text-[10.5px] tabular-nums text-dimmed"
								>
									band [{{ situation.relevanceBand[0] }}, {{ situation.relevanceBand[1] }}]
								</span>
							</div>
							<p class="text-[12.5px] leading-relaxed text-muted">{{ situation.description }}</p>
							<video
								:src="`/api/situations/${situation.id}/clip`"
								controls
								preload="none"
								playsinline
								class="mt-auto aspect-video w-full rounded-sm border border-default bg-black object-contain"
							/>
						</div>
					</div>
					<p v-else class="text-[12.5px] text-dimmed">
						{{ situationsQuery.error.value?.message ?? "No situation fixtures in situations/" }}
					</p>
				</section>

				<!-- Matrix: situations × engines -->
				<section
					v-if="latestRun && (latestRun.engines?.length ?? 1) > 1"
					class="flex flex-col gap-2"
					aria-label="Engine matrix"
				>
					<h2 class="font-mono text-[10px] uppercase tracking-[0.16em] text-dimmed">
						Matrix
					</h2>
					<div class="overflow-x-auto rounded-md border border-default">
						<table class="w-full border-collapse font-mono text-[11px] tabular-nums">
							<thead>
								<tr class="border-b border-default bg-elevated text-left">
									<th class="px-3 py-2 font-normal tracking-[0.08em] text-dimmed uppercase text-[9.5px]">
										Situation
									</th>
									<th
										v-for="engine in matrixEngines"
										:key="engine"
										class="px-3 py-2 font-normal tracking-[0.08em] text-dimmed uppercase text-[9.5px]"
									>
										{{ engine }}
									</th>
								</tr>
							</thead>
							<tbody>
								<tr
									v-for="situation in situations"
									:key="situation.id"
									class="border-b border-default last:border-b-0"
								>
									<td class="px-3 py-2 text-highlighted">{{ situation.id }}</td>
									<td
										v-for="engine in matrixEngines"
										:key="engine"
										class="px-3 py-2"
									>
										<span
											v-if="matrixCell(situation.id, engine) !== 'missing'"
											:class="matrixCell(situation.id, engine) === 'pass'
												? 'text-success'
												: 'text-error'"
										>
											{{ matrixCell(situation.id, engine) === "pass" ? "PASS" : "FAIL" }}
										</span>
										<span v-else class="text-dimmed">n/a</span>
									</td>
								</tr>
							</tbody>
						</table>
					</div>

					<!-- Per-engine scorecards -->
					<div class="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
						<div
							v-for="summary in latestRun.engineSummaries ?? []"
							:key="summary.engine"
							class="flex flex-col gap-1.5 rounded-md border border-default bg-elevated p-3 font-mono text-[10.5px] tabular-nums"
						>
							<div class="flex items-center justify-between">
								<span class="text-highlighted">{{ summary.engine }}</span>
								<UBadge
									:color="summary.passed === summary.total ? 'success' : 'error'"
									variant="subtle"
									size="sm"
								>
									{{ summary.passed }}/{{ summary.total }}
								</UBadge>
							</div>
							<template v-if="summary.unavailable">
								<span class="text-warning break-words">{{ summary.unavailable }}</span>
							</template>
							<template v-else>
								<span class="text-muted">
									speak recall
									<span class="text-highlighted">
										{{ summary.speakRecall?.spoke ?? 0 }}/{{ summary.speakRecall?.expected ?? 0 }}
									</span>
								</span>
								<span class="text-muted">
									silence precision
									<span class="text-highlighted">
										{{ summary.silencePrecision?.stayedSilent ?? 0 }}/{{ summary.silencePrecision?.expected ?? 0 }}
									</span>
								</span>
								<span class="text-muted">
									avg latency
									<span class="text-highlighted">{{ Math.round(summary.avgLatencyMs ?? 0) }}ms</span>
								</span>
								<span class="text-muted">
									confidence
									<span class="text-highlighted">
										ok {{ summary.calibration.onCorrect?.toFixed(2) ?? "n/a" }} ·
										miss {{ summary.calibration.onIncorrect?.toFixed(2) ?? "n/a" }}
									</span>
								</span>
							</template>
						</div>
					</div>
				</section>

				<!-- Latest run: watch the clip, judge the verdict -->
				<section class="flex flex-col gap-3" aria-label="Latest run">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<h2 class="font-mono text-[10px] uppercase tracking-[0.16em] text-dimmed">
							Latest run
						</h2>
						<span v-if="latestRun" class="font-mono text-[10.5px] tabular-nums text-dimmed">
							{{ formatDate(latestRun.startedAt) }} {{ formatTime(latestRun.startedAt) }}
							<span aria-hidden="true">·</span>
							{{ (latestRun.engines ?? [latestRun.engine]).join(", ") }}
							<template v-if="latestRun.judge">
								<span aria-hidden="true">·</span>
								judged
							</template>
						</span>
					</div>

					<div
						v-if="latestRun"
						class="grid items-start gap-4 lg:grid-cols-2"
					>
						<div
							v-for="result in latestRun.results"
							:key="`${result.engine ?? 'fused'}:${result.situationId}`"
							class="flex flex-col gap-2.5 rounded-md border p-3.5"
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
									<UBadge
										color="neutral"
										variant="outline"
										size="sm"
										class="font-mono"
									>
										{{ result.engine ?? "fused" }}
									</UBadge>
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
											@click="setVerdict.mutate({ runId: latestRun.id, situationId: result.situationId, engine: result.engine ?? 'fused', humanVerdict: 'agree' })"
										/>
										<UButton
											label="Override"
											color="warning"
											variant="soft"
											:loading="savingVerdict"
											@click="setVerdict.mutate({ runId: latestRun.id, situationId: result.situationId, engine: result.engine ?? 'fused', humanVerdict: 'override' })"
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
								class="w-full rounded-sm border border-default bg-black object-contain"
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
									<template v-if="pass.gate">
										<span>conf {{ pass.gate.confidence.toFixed(2) }}</span>
										<span class="uppercase">{{ pass.gate.relevanceClass }} · {{ pass.gate.category }}</span>
									</template>
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
				</section>

				<!-- Drift: pass rate across runs -->
				<section v-if="runs.length > 1" class="flex flex-col gap-2" aria-label="Drift across runs">
					<h2 class="font-mono text-[10px] uppercase tracking-[0.16em] text-dimmed">
						Drift · last {{ Math.min(runs.length, 8) }} runs
					</h2>
					<div class="flex flex-col divide-y divide-(--ui-border-accented) rounded-md border border-default">
						<div
							v-for="run in runs.slice(0, 8)"
							:key="run.id"
							class="flex items-center justify-between px-3 py-1.5 font-mono text-[10.5px] tabular-nums"
						>
							<span class="text-muted">
								{{ formatDate(run.startedAt) }} {{ formatTime(run.startedAt) }}
							</span>
							<div class="flex items-center gap-3">
								<span class="text-dimmed">{{ (run.engines ?? [run.engine]).join(", ") }}</span>
								<span :class="run.summary.failed === 0 && run.status === 'done' ? 'text-success' : 'text-warning'">
									{{ run.summary.passed }}/{{ run.summary.total }}
								</span>
								<span class="w-14 text-right text-dimmed">{{ run.status }}</span>
							</div>
						</div>
					</div>
				</section>
			</div>
		</template>
	</UDashboardPanel>
</template>
