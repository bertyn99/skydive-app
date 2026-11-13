/**
 * Eval harness (glossary: Situation, Eval run). Runs Situation fixtures
 * through the real pipeline (gemini.describeVideo — the exact function the
 * live engine uses) and scores them with deterministic checks, so prompt or
 * model changes can be regression-tested without launching Skyrim.
 *
 * Results persist to `situations/results/<runId>.json` for drift tracking.
 * One run at a time (module singleton); the runner mutates the shared
 * observation history in gemini.ts, so don't run a live session concurrently.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	clearHistory,
	describeVideo,
	GEMINI_MODEL_ID,
	judgeObservation,
	type JudgeVerdict,
} from "./gemini";
import { isSilent } from "./silence";
import type { SkyrimConnector } from "./skyrim-connector";

export const SITUATIONS_DIR = "situations";
const RESULTS_DIR = path.join(SITUATIONS_DIR, "results");

export type Expectation = "speak" | "silence";

export interface SituationDefinition {
	/** Matches the directory name. */
	id: string;
	description: string;
	/** Clip filename inside the situation directory (webm or mp4). */
	clip: string;
	/** Optional mod context pushed with the clip (GameStateData-shaped). */
	modContext?: Record<string, unknown> | null;
	expectation: Expectation;
	/** Inclusive relevance band. Defaults: silence → [0, 3], speak → [4, 10]. */
	relevanceBand?: [number, number];
	/** Max sentences allowed in the observation (default 2; init mode allows 3). */
	maxSentences?: number;
	/** Allowed action types; empty array means "no actions expected". */
	expectedActions?: string[];
	/** Keywords the observation must contain (outcome-based content check). */
	mustMention?: string[];
	/** Keywords the observation must not contain. */
	mustNotMention?: string[];
	notes?: string;
	/**
	 * Silence-discipline fixture (YGG-235): the clip is fed a second time
	 * with history retained — the assistant must stay silent on the repeat.
	 */
	repeat?: { expectation: Expectation; relevanceBand?: [number, number] };
}

/** Which pipeline tier a check measures (decision vs composer output). */
export type CheckTier = "decision" | "composer";

export interface CheckResult {
	name: string;
	tier: CheckTier;
	passed: boolean;
	detail?: string;
}

export interface PassResult {
	pass: number;
	expectation: Expectation;
	/** Raw observation text from the model (null = model chose silence). */
	observation: string | null;
	spoken: boolean;
	relevance: number;
	actions: string[];
	latencyMs: number;
	checks: CheckResult[];
	verdict: "pass" | "fail";
	/** LLM-as-judge rubric verdict (optional, run-flag gated). */
	judge?: JudgeVerdict;
	judgeError?: string;
	error?: string;
}

export interface SituationResult {
	situationId: string;
	passed: boolean;
	/** Human verdict slot — deterministic checks decide, humans arbitrate. */
	humanVerdict: "agree" | "override" | null;
	humanNote: string;
	passes: PassResult[];
}

export interface EvalRun {
	id: string;
	startedAt: number;
	finishedAt: number | null;
	status: "running" | "done" | "error";
	engine: string;
	/** Whether an LLM judge graded each pass (agentic-eval pattern). */
	judge: boolean;
	summary: { total: number; passed: number; failed: number };
	results: SituationResult[];
}

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

function clipMimeType(clipFile: string): string {
	switch (path.extname(clipFile).toLowerCase()) {
		case ".webm":
			return "video/webm";
		case ".mp4":
		case ".m4v":
			return "video/mp4";
		case ".mkv":
			return "video/x-matroska";
		default:
			throw new Error(`Unsupported clip extension: ${clipFile}`);
	}
}

function parseDefinition(dirName: string, raw: unknown): SituationDefinition {
	const def = raw as Partial<SituationDefinition>;
	if (typeof def.id !== "string" || def.id !== dirName) {
		throw new Error(`situation.json id must match the directory name (${dirName})`);
	}
	if (def.expectation !== "speak" && def.expectation !== "silence") {
		throw new Error(`expectation must be "speak" or "silence"`);
	}
	if (typeof def.clip !== "string" || def.clip.includes("..")) {
		throw new Error(`clip must be a local filename`);
	}
	if (def.repeat && def.repeat.expectation !== "speak" && def.repeat.expectation !== "silence") {
		throw new Error(`repeat.expectation must be "speak" or "silence"`);
	}
	return def as SituationDefinition;
}

export async function listSituations(): Promise<SituationDefinition[]> {
	const entries = await readdir(SITUATIONS_DIR, { withFileTypes: true });
	const situations: SituationDefinition[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name === "results") continue;
		const file = path.join(SITUATIONS_DIR, entry.name, "situation.json");
		let raw: unknown;
		try {
			raw = JSON.parse(await readFile(file, "utf8"));
		} catch (err) {
			throw new Error(
				`Invalid situation fixture ${entry.name}: ${err instanceof Error ? err.message : String(err)}`,
				{ cause: err },
			);
		}
		situations.push(parseDefinition(entry.name, raw));
	}
	return situations.sort((a, b) => a.id.localeCompare(b.id));
}

async function loadClip(def: SituationDefinition): Promise<{
	buffer: Buffer;
	mimeType: string;
}> {
	const clipPath = path.join(SITUATIONS_DIR, def.id, def.clip);
	const buffer = await readFile(clipPath);
	return { buffer, mimeType: clipMimeType(def.clip) };
}

/** Connector that replays the fixture's mod context instead of live data. */
function fixtureConnector(
	modContext: Record<string, unknown> | null | undefined,
): SkyrimConnector {
	return {
		getContext: async () => ({ raw: modContext ?? null }),
		sendAction: async () => ({ success: false }),
	};
}

// ---------------------------------------------------------------------------
// Deterministic checks
// ---------------------------------------------------------------------------

const FRENCH_MARKERS = new Set([
	"le", "la", "les", "un", "une", "des", "du", "de", "à", "au", "aux",
	"et", "est", "sont", "dans", "sur", "tout", "toute", "très", "près",
	"loin", "devant", "derrière", "gauche", "droite", "ennemi", "ennemis",
	"porte", "portes", "coffre", "coffres", "chemin", "passage", "grotte",
	"couloir", "escalier", "nord", "sud", "attaque", "attaquez", "bloque",
	"bloquez", "esquive", "esquivez", "parez", "buvez", "potion", "potions",
	"avancez", "reculez", "parlez", "allez", "venez", "montez", "descendez",
	"deux", "trois", "mètres", "secondes", "c'est", "il", "elle", "vous",
	"je", "ne", "pas", "plus", "voix", "urgent", "urgence", "danger",
	// Gameplay vocabulary observed in real model output
	"dragon", "dragons", "cible", "cibles", "perdu", "perdue", "envole",
	"atterri", "vole", "fuyez", "fuite", "rentrez", "abritez", "attendez",
	"arrêtez", "faible", "critique", "vital", "vitale", "santé", "bouclier",
	"arme", "armes", "équipez", "utilisez", "ouvrez", "activez", "traversez",
	"tournez", "prenez", "laissez", "regardez", "silence", "poursuivez",
	"repli", "touché", "blessé", "creuse", "ruine", "tour", "mur", "pont",
	"rivière", "forêt", "montagne", "vallée", "village", "donjon", "camp",
]);

const ENGLISH_MARKERS = new Set([
	"enemy", "enemies", "door", "doors", "ahead", "behind", "left", "right",
	"near", "close", "far", "block", "blocks", "blocking", "attack", "attacks",
	"attacking", "drink", "potion", "potions", "talk", "npc", "chest", "trap",
	"stop", "turn", "health", "low", "the", "and", "now", "with", "your",
	"you", "is", "are", "walk", "run", "jump", "speak", "stay", "move",
]);

function checkFrench(observation: string): CheckResult {
	const tokens = observation
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^\p{L}\s']/gu, " ")
		.split(/\s+/)
		.filter(Boolean);

	// Both lexicons are checked on de-accented forms (é→e), so keep the
	// marker sets ASCII-only when matching.
	const asciiMarkers = (set: Set<string>): Set<string> =>
		new Set(
			[...set].map((word) =>
				word.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
			),
		);
	const french = asciiMarkers(FRENCH_MARKERS);
	const english = asciiMarkers(ENGLISH_MARKERS);

	const englishHits = tokens.filter((token) => english.has(token));
	if (englishHits.length > 0) {
		return {
			name: "french",
			tier: "composer",
			passed: false,
			detail: `English tokens: ${englishHits.join(", ")}`,
		};
	}
	const frenchHits = tokens.filter((token) => french.has(token));
	if (frenchHits.length === 0) {
		return {
			name: "french",
			tier: "composer",
			passed: false,
			detail: "no French markers found",
		};
	}
	return { name: "french", tier: "composer", passed: true };
}

function checkSentenceLimit(observation: string, maxSentences: number): CheckResult {
	const sentences = observation
		.split(/[.!?]+/)
		.map((sentence) => sentence.trim())
		.filter(Boolean);
	if (sentences.length > maxSentences) {
		return {
			name: "sentenceLimit",
			tier: "composer",
			passed: false,
			detail: `${sentences.length} sentences (max ${maxSentences})`,
		};
	}
	return { name: "sentenceLimit", tier: "composer", passed: true };
}

/** Outcome-based content check: keywords that must (not) appear. */
function checkMentions(
	observation: string,
	mustMention: string[] | undefined,
	mustNotMention: string[] | undefined,
): CheckResult[] {
	const checks: CheckResult[] = [];
	const normalized = observation
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "");

	if (mustMention && mustMention.length > 0) {
		const missing = mustMention.filter((keyword) => {
			const needle = keyword
				.toLowerCase()
				.normalize("NFD")
				.replace(/[\u0300-\u036f]/g, "");
			return !normalized.includes(needle);
		});
		checks.push({
			name: "mustMention",
			tier: "composer",
			passed: missing.length === 0,
			detail: missing.length === 0
				? `contains required keywords (${mustMention.join(", ")})`
				: `missing keywords: ${missing.join(", ")}`,
		});
	}

	if (mustNotMention && mustNotMention.length > 0) {
		const forbidden = mustNotMention.filter((keyword) => {
			const needle = keyword
				.toLowerCase()
				.normalize("NFD")
				.replace(/[\u0300-\u036f]/g, "");
			return normalized.includes(needle);
		});
		checks.push({
			name: "mustNotMention",
			tier: "composer",
			passed: forbidden.length === 0,
			detail: forbidden.length === 0
				? `no forbidden keywords (${mustNotMention.join(", ")})`
				: `forbidden keywords found: ${forbidden.join(", ")}`,
		});
	}

	return checks;
}

/**
 * Pipeline semantics for "spoke": produced text that is not a silence
 * marker AND cleared the relevance bar — exactly what the engine turns
 * into TTS + a spoken observation.
 */
function spokeInPipeline(observation: string | null, relevance: number): boolean {
	if (observation === null || isSilent(observation)) return false;
	return relevance >= 4;
}

function defaultBand(expectation: Expectation): [number, number] {
	return expectation === "speak" ? [4, 10] : [0, 3];
}

function runChecks(
	observation: string | null,
	relevance: number,
	actions: string[],
	expectation: Expectation,
	band: [number, number],
	maxSentences: number,
	def: SituationDefinition,
): CheckResult[] {
	const checks: CheckResult[] = [];

	// --- Decision tier: did the assistant make the right call? ---
	const spoken = spokeInPipeline(observation, relevance);
	const expectedSpoken = expectation === "speak";
	checks.push({
		name: "spoken",
		tier: "decision",
		passed: spoken === expectedSpoken,
		detail: expectedSpoken
			? spoken
				? "spoke as expected"
				: "expected an observation, got silence"
			: spoken
				? "expected silence, got an observation"
				: "stayed silent as expected",
	});

	checks.push({
		name: "relevanceBand",
		tier: "decision",
		passed: relevance >= band[0] && relevance <= band[1],
		detail: `relevance ${relevance} vs band [${band[0]}, ${band[1]}]`,
	});

	if (def.expectedActions !== undefined) {
		const unexpected = actions.filter(
			(action) => !def.expectedActions?.includes(action),
		);
		checks.push({
			name: "actions",
			tier: "decision",
			passed: unexpected.length === 0,
			detail:
				def.expectedActions.length === 0
					? actions.length === 0
						? "no actions, as expected"
						: `expected no actions, got: ${actions.join(", ")}`
					: unexpected.length === 0
						? `actions within expected types (${def.expectedActions.join(", ")})`
						: `unexpected action types: ${unexpected.join(", ")}`,
		});
	}

	// --- Composer tier: is the spoken output well-formed? ---
	if (observation !== null && !isSilent(observation)) {
		checks.push(checkFrench(observation));
		checks.push(checkSentenceLimit(observation, maxSentences));
		checks.push(...checkMentions(observation, def.mustMention, def.mustNotMention));
	}

	return checks;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

let activeRun: EvalRun | null = null;

export function getActiveRun(): EvalRun | null {
	return activeRun;
}

async function persistRun(run: EvalRun): Promise<void> {
	await mkdir(RESULTS_DIR, { recursive: true });
	await writeFile(
		path.join(RESULTS_DIR, `${run.id}.json`),
		JSON.stringify(run, null, "\t"),
	);
}

async function evaluatePass(
	def: SituationDefinition,
	clip: { buffer: Buffer; mimeType: string },
	pass: number,
	expectation: Expectation,
	judgeEnabled: boolean,
): Promise<PassResult> {
	const start = Date.now();
	try {
		const { response } = await describeVideo(
			clip.buffer,
			undefined,
			fixtureConnector(def.modContext),
			undefined,
			clip.mimeType,
		);
		const latencyMs = Date.now() - start;
		const observation = response.observation;
		const actions = response.actions.map((action) => action.type);
		const spoken = spokeInPipeline(observation, response.relevance);
		// Pass 2 (repeat) resolves its own band: the replay is judged as a
		// silence expectation, not with pass 1's speak band.
		const band = (pass === 1 ? def.relevanceBand : def.repeat?.relevanceBand)
			?? defaultBand(expectation);
		const checks = runChecks(
			observation,
			response.relevance,
			actions,
			expectation,
			band,
			def.maxSentences ?? 2,
			def,
		);
		const result: PassResult = {
			pass,
			expectation,
			observation,
			spoken,
			relevance: response.relevance,
			actions,
			latencyMs,
			checks,
			verdict: checks.every((check) => check.passed) ? "pass" : "fail",
		};

		// LLM-as-judge (optional): rubric grade on the same clip. Never
		// flips the deterministic verdict — informs the human arbiter.
		if (judgeEnabled) {
			try {
				result.judge = await judgeObservation(clip.buffer, clip.mimeType, {
					expectation,
					description: def.description,
					observation,
					relevance: response.relevance,
				});
			} catch (err) {
				result.judgeError =
					err instanceof Error ? err.message : String(err);
			}
		}

		return result;
	} catch (err) {
		return {
			pass,
			expectation,
			observation: null,
			spoken: false,
			relevance: 0,
			actions: [],
			latencyMs: Date.now() - start,
			checks: [],
			verdict: "fail",
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

async function evaluateSituation(
	def: SituationDefinition,
	judgeEnabled: boolean,
): Promise<SituationResult> {
	// Fresh observation history per Situation (glossary: Eval run).
	clearHistory();
	const clip = await loadClip(def);

	const result: SituationResult = {
		situationId: def.id,
		passed: false,
		humanVerdict: null,
		humanNote: "",
		passes: [],
	};

	result.passes.push(
		await evaluatePass(def, clip, 1, def.expectation, judgeEnabled),
	);

	if (def.repeat) {
		// History retained on purpose: the novelty filter must catch it.
		result.passes.push(
			await evaluatePass(def, clip, 2, def.repeat.expectation, judgeEnabled),
		);
	}

	result.passed = result.passes.every((pass) => pass.verdict === "pass");
	return result;
}

export async function startRun(
	ids?: string[],
	judge = true,
): Promise<EvalRun> {
	if (activeRun && activeRun.status === "running") {
		throw new Error("A run is already in progress");
	}

	const all = await listSituations();
	const selected = ids && ids.length > 0
		? ids.map((id) => {
				const found = all.find((situation) => situation.id === id);
				if (!found) throw new Error(`Unknown situation: ${id}`);
				return found;
			})
		: all;
	if (selected.length === 0) {
		throw new Error("No situation fixtures found in situations/");
	}

	const run: EvalRun = {
		id: `run-${new Date().toISOString().replace(/[:.]/g, "-")}`,
		startedAt: Date.now(),
		finishedAt: null,
		status: "running",
		engine: GEMINI_MODEL_ID,
		judge,
		summary: { total: selected.length, passed: 0, failed: 0 },
		results: [],
	};
	activeRun = run;
	await persistRun(run);

	// Fire-and-forget: the API route returns the runId immediately and the
	// dashboard polls for progress.
	void (async () => {
		try {
			for (const def of selected) {
				const result = await evaluateSituation(def, judge);
				run.results.push(result);
				if (result.passed) {
					run.summary.passed += 1;
				} else {
					run.summary.failed += 1;
				}
				await persistRun(run);
			}
			run.status = "done";
		} catch (err) {
			run.status = "error";
			run.results.push({
				situationId: "(runner)",
				passed: false,
				humanVerdict: null,
				humanNote: err instanceof Error ? err.message : String(err),
				passes: [],
			});
		} finally {
			run.finishedAt = Date.now();
			await persistRun(run);
		}
	})();

	return run;
}

export async function listRuns(): Promise<EvalRun[]> {
	let files: string[];
	try {
		files = (await readdir(RESULTS_DIR)).filter((file) => file.endsWith(".json"));
	} catch {
		return activeRun ? [activeRun] : [];
	}

	const runs: EvalRun[] = [];
	for (const file of files) {
		try {
			runs.push(JSON.parse(await readFile(path.join(RESULTS_DIR, file), "utf8")));
		} catch {
			// Skip unreadable result files (partial writes from a crash).
		}
	}
	if (activeRun && !runs.some((run) => run.id === activeRun?.id)) {
		runs.push(activeRun);
	}
	return runs.sort((a, b) => b.startedAt - a.startedAt);
}

export async function getRun(runId: string): Promise<EvalRun | null> {
	if (activeRun && activeRun.id === runId) return activeRun;
	try {
		return JSON.parse(
			await readFile(path.join(RESULTS_DIR, `${runId}.json`), "utf8"),
		);
	} catch {
		return null;
	}
}

export async function setVerdict(
	runId: string,
	situationId: string,
	verdict: "agree" | "override",
	note: string,
): Promise<EvalRun | null> {
	const run = await getRun(runId);
	if (!run) throw new Error(`Unknown run: ${runId}`);
	const result = run.results.find((entry) => entry.situationId === situationId);
	if (!result) throw new Error(`Run ${runId} has no result for ${situationId}`);

	result.humanVerdict = verdict;
	result.humanNote = note;
	if (activeRun && activeRun.id === runId) {
		const liveResult = activeRun.results.find(
			(entry) => entry.situationId === situationId,
		);
		if (liveResult) {
			liveResult.humanVerdict = verdict;
			liveResult.humanNote = note;
		}
	}
	await persistRun(run);
	return run;
}
