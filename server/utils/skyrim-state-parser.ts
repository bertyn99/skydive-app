// Parse raw Skyrim mod state JSON into a readable French system message for Gemini
// The mod stores data by type (float, int, string) with parallel arrays for lists

type RawState = Record<string, unknown>;

function getMap(raw: RawState, key: string): Record<string, unknown> {
	const val = raw[key];
	return val && typeof val === "object" && !Array.isArray(val)
		? (val as Record<string, unknown>)
		: {};
}

function getFloat(floats: Record<string, unknown>, key: string): number | null {
	const v = floats[key];
	return typeof v === "number" ? v : null;
}

function getInt(ints: Record<string, unknown>, key: string): number | null {
	const v = ints[key];
	return typeof v === "number" ? v : null;
}

function getString(
	strings: Record<string, unknown>,
	key: string,
): string | null {
	const v = strings[key];
	return typeof v === "string" && v.length > 0 ? v : null;
}

function getNumberList(lists: Record<string, unknown>, key: string): number[] {
	const v = lists[key];
	return Array.isArray(v)
		? v.filter((x): x is number => typeof x === "number")
		: [];
}

function getStringList(lists: Record<string, unknown>, key: string): string[] {
	const v = lists[key];
	return Array.isArray(v)
		? v.filter((x): x is string => typeof x === "string")
		: [];
}

function formatPlayer(
	floats: Record<string, unknown>,
	ints: Record<string, unknown>,
	strings: Record<string, unknown>,
): string {
	const lines: string[] = [];

	// Location + interior/exterior
	const location = getString(strings, "player.location");
	const isInterior = getInt(ints, "player.is_in_interior") === 1;
	if (location) {
		lines.push(
			`- Position: ${location}${isInterior ? " (intérieur)" : " (extérieur)"}`,
		);
	}

	// Compass direction
	const compass = getString(strings, "player.compass");
	if (compass) {
		lines.push(`- Direction: ${compass}`);
	}

	// Vitals
	const health = getFloat(floats, "player.health");
	const healthMax = getFloat(floats, "player.health_max");
	const magicka = getFloat(floats, "player.magicka");
	const stamina = getFloat(floats, "player.stamina");
	if (health !== null) {
		const parts = [
			`Santé: ${Math.round(health)}${healthMax !== null ? `/${Math.round(healthMax)}` : ""}`,
		];
		if (magicka !== null) parts.push(`Magie: ${Math.round(magicka)}`);
		if (stamina !== null) parts.push(`Endurance: ${Math.round(stamina)}`);
		lines.push(`- ${parts.join(" | ")}`);
	}

	// Player state flags
	const flags: string[] = [];
	if (getInt(ints, "player.in_combat") === 1) flags.push("En combat");
	if (getInt(ints, "player.in_dialogue") === 1) flags.push("En dialogue");
	if (getInt(ints, "player.is_running") === 1) flags.push("En course");
	if (getInt(ints, "player.is_sneaking") === 1) flags.push("Furtif");
	if (getInt(ints, "player.is_swimming") === 1) flags.push("Nage");
	if (getInt(ints, "player.is_weapon_drawn") === 1) flags.push("Arme dégainée");
	if (getInt(ints, "player.is_stuck") === 1) flags.push("Bloqué");
	if (flags.length > 0) {
		lines.push(`- État: ${flags.join(", ")}`);
	}

	return lines.length > 0 ? `### Joueur\n${lines.join("\n")}` : "";
}

function formatScene(ints: Record<string, unknown>): string {
	const lines: string[] = [];

	const enemies = getInt(ints, "enemies.count");
	if (enemies !== null) {
		lines.push(enemies > 0 ? `- Ennemis: ${enemies}` : "- Aucun ennemi");
	}

	const obstacle = getInt(ints, "player.obstacle_front");
	if (obstacle !== null) {
		lines.push(
			obstacle === 1 ? "- Obstacle devant" : "- Pas d'obstacle devant",
		);
	}

	return lines.length > 0 ? `### Scène\n${lines.join("\n")}` : "";
}

function formatNpcs(
	floatLists: Record<string, unknown>,
	stringLists: Record<string, unknown>,
	ints: Record<string, unknown>,
): string {
	const names = getStringList(stringLists, "npcs.name");
	const distances = getNumberList(floatLists, "npcs.distance_m");
	const clocks = getStringList(stringLists, "npcs.clock");
	const count = getInt(ints, "npcs.count") ?? names.length;

	if (count === 0 || names.length === 0) return "";

	// Build NPC entries from parallel arrays
	const npcs = names.map((name, i) => ({
		name,
		distance: i < distances.length ? distances[i] : null,
		clock: i < clocks.length ? clocks[i] : null,
	}));

	// Sort by distance (closest first)
	npcs.sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999));

	const lines = npcs.map((npc) => {
		const parts = [`- ${npc.name}`];
		if (npc.distance !== null) parts.push(`à ${Math.round(npc.distance)}m`);
		if (npc.clock) parts.push(`direction ${npc.clock}`);
		return parts.join(", ");
	});

	return `### PNJs proches (${count})\n${lines.join("\n")}`;
}

function formatQuest(strings: Record<string, unknown>): string {
	const quest = getString(strings, "quest_active");
	return quest ? `### Quête active\n${quest}` : "";
}

export function parseSkyrimState(raw: Record<string, unknown>): string {
	try {
		const floats = getMap(raw, "float");
		const ints = getMap(raw, "int");
		const strings = getMap(raw, "string");
		const floatLists = getMap(raw, "floatList");
		const stringLists = getMap(raw, "stringList");

		const sections = [
			formatPlayer(floats, ints, strings),
			formatScene(ints),
			formatNpcs(floatLists, stringLists, ints),
			formatQuest(strings),
		].filter(Boolean);

		if (sections.length === 0) return "";

		return `## ÉTAT DU JEU\n\n${sections.join("\n\n")}`;
	} catch {
		return "";
	}
}
