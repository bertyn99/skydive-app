/**
 * Silence detection shared by the live engine and the eval runner, so
 * deterministic checks judge observations exactly like the pipeline does
 * (glossary: SILENCE is the default output).
 */
const SILENCE_MARKERS = [
	"...",
	"rien à signaler",
	"rien à signaler.",
	"zone calme",
	"zone calme.",
];

export function isSilent(text: string): boolean {
	const trimmed = text.trim().toLowerCase();
	if (trimmed === "" || trimmed.replace(/\./g, "").trim() === "") return true;
	if (SILENCE_MARKERS.includes(trimmed)) return true;
	if (trimmed.replace(/[.\s]/g, "").length < 3) return true;
	return false;
}
