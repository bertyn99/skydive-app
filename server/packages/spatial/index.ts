/**
 * Spatial radar (W5) — pure cue selection from the state.json dump
 * (context lane; the dump is written every 500ms tick and never suppressed,
 * so it is fresh enough for the 2500ms radar cadence).
 *
 * Ported from Skyrim Access's ambient radar (docs/ACCESSIBILITY-PORT.md
 * §5.6): 1500-unit radius (~21 m), one sweep every 2500 ms, ≤8 nearest
 * objects per sweep. The spatialization itself runs in the Electron player
 * (WebAudio HRTF) — see src/utils/spatial-audio.ts.
 */

export const RADAR_RADIUS_UNITS = 1500;
export const RADAR_MAX_CUES = 8;
export const RADAR_CADENCE_MS = 2500;

export interface RadarCue {
	/** Ref formId — the client dedupes sweeps by id. */
	id: number;
	category: string;
	/**
	 * Bearing relative to the player's facing, in radians: 0 = front,
	 * +π/2 = right, ±π = behind. Computed server-side from the absolute
	 * `bearing_deg` minus the fast-lane `player.headingAngleZ`.
	 */
	bearingRad: number;
	distanceU: number;
	/** Linear falloff over the radius, floored so far cues stay audible. */
	gain: number;
}

type RawMap = Record<string, unknown>;

function getMap(raw: RawMap, key: string): RawMap {
	const val = raw[key];
	return val && typeof val === "object" && !Array.isArray(val)
		? (val as RawMap)
		: {};
}

function getNumberList(lists: RawMap, key: string): number[] {
	const v = lists[key];
	return Array.isArray(v)
		? v.filter((x): x is number => typeof x === "number")
		: [];
}

function getStringList(lists: RawMap, key: string): string[] {
	const v = lists[key];
	return Array.isArray(v)
		? v.filter((x): x is string => typeof x === "string")
		: [];
}

function getInt(ints: RawMap, key: string): number | null {
	const v = ints[key];
	return typeof v === "number" ? v : null;
}

function relativeBearingDeg(absoluteDeg: number, playerHeadingDeg: number): number {
	return ((absoluteDeg - playerHeadingDeg + 540) % 360) - 180;
}

export interface RadarSelectionInput {
	/** The raw state.json dump (same shape parseSkyrimState consumes). */
	raw: RawMap;
	/** Fast-lane `player.headingAngleZ` (absolute, degrees). Null = no heading — cues keep absolute bearings. */
	playerHeadingDeg: number | null;
}

/**
 * ≤8 nearest in-radius cues, nearest first. Skyrim Access coexistence (W2):
 * when their ESP is installed the plugin flags it and THEY own the radar
 * channel — selection returns an empty sweep.
 */
export function selectRadarCues(input: RadarSelectionInput): RadarCue[] {
	const ints = getMap(input.raw, "int");
	if (getInt(ints, "skyrim_access.installed") === 1) return [];

	const floatLists = getMap(input.raw, "floatList");
	const stringLists = getMap(input.raw, "stringList");
	const ids = getNumberList(floatLists, "world.objects.form_id");
	const distances = getNumberList(floatLists, "world.objects.distance_u");
	const bearings = getNumberList(floatLists, "world.objects.bearing_deg");
	const categories = getStringList(stringLists, "world.objects.category");

	const heading = input.playerHeadingDeg ?? 0;

	interface Candidate {
		id: number;
		category: string;
		distance: number;
		bearingDeg: number;
	}

	const candidates: Candidate[] = [];
	// Lock-step parallel arrays (dump contract) — stop at the shortest to be
	// safe against a malformed producer.
	const count = Math.min(ids.length, distances.length, bearings.length);
	for (let i = 0; i < count; i++) {
		const distance = distances[i]!;
		if (distance > RADAR_RADIUS_UNITS) continue;
		candidates.push({
			id: ids[i]!,
			category: categories[i] ?? "other",
			distance,
			bearingDeg: bearings[i] ?? 0,
		});
	}

	candidates.sort((a, b) => a.distance - b.distance);

	return candidates.slice(0, RADAR_MAX_CUES).map((candidate) => {
		const rel = relativeBearingDeg(candidate.bearingDeg, heading);
		const gain = Math.max(0.08, 1 - candidate.distance / RADAR_RADIUS_UNITS);
		return {
			id: candidate.id,
			category: candidate.category,
			bearingRad: Math.round(((rel * Math.PI) / 180) * 1000) / 1000,
			distanceU: Math.round(candidate.distance),
			gain: Math.round(gain * 100) / 100,
		};
	});
}
