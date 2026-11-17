/**
 * Deterministic French announcement grammar for scanner/radar/navigation
 * lines — Tier 1 of the narration stack. These strings go straight to TTS
 * (cancel/queue channels via the W2 arbiter) with NO model round-trip:
 * Skyrim Access has proven for years that navigation callouts must be
 * template-fast, and our composer (LLM) is reserved for novel phrasing.
 *
 * Output contract, ported from their scanner speech ("Chest, locked, empty,
 * northwest"): `Coffre, à 8 m, nord, verrouillé`.
 */

export interface ScannedObjectAnnouncement {
	name: string;
	distanceM: number;
	/** Absolute compass sector, capitalized dump style ("Nord-Est"). */
	compass?: string | null;
	/** Plugin flag tokens ("locked" | "empty" | "corpse" | "open" | "harvested"). */
	flags?: string[];
}

const FLAG_FR: Record<string, string> = {
	locked: "verrouillé",
	empty: "vide",
	corpse: "cadavre",
	open: "ouvert",
	harvested: "récolté",
};

/**
 * Their distance-phrasing rule (docs/ACCESSIBILITY-PORT.md §5.6): round to
 * the nearest meter; never say "0 meters" — sub-meter distances get words.
 */
export function formatDistance(m: number): string {
	if (m < 0.5) return "moins d'un mètre";
	return `${Math.round(m)} m`;
}

function formatFlags(flags: string[]): string {
	return flags
		.map((flag) => FLAG_FR[flag])
		.filter(Boolean)
		.join(", ");
}

export function formatObjectAnnouncement(object: ScannedObjectAnnouncement): string {
	const parts: string[] = [object.name];
	parts.push(`à ${formatDistance(object.distanceM)}`);
	if (object.compass) parts.push(object.compass.toLowerCase());
	const flags = formatFlags(object.flags ?? []);
	if (flags) parts.push(flags);
	return parts.join(", ");
}

/** Spoken list of the nearest objects ("…, puis …") — used by on-demand scans. */
export function formatNearestObjects(
	objects: ScannedObjectAnnouncement[],
	max: number = 3,
): string {
	const lines = objects.slice(0, Math.max(0, max)).map(formatObjectAnnouncement);
	if (lines.length === 0) return "Aucun objet à proximité.";
	return lines.join(", puis ");
}
