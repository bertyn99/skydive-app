/**
 * Spatial radar playback (W5) — Electron player window ONLY (the dashboard
 * ignores `spatial` messages; two radars would double-pan every cue).
 *
 * True HRTF positioning: the server sends each cue's bearing RELATIVE to
 * the player's facing, so the listener always faces forward (-Z) and the
 * source sits at (sin θ · d, 0, -cos θ · d). A stereo `pan=` node cannot
 * separate front from back — that separation is the whole point of a radar.
 *
 * Earcons are SYNTHESIZED (oscillator + envelope, distinct per category) —
 * no binary assets to ship, and the radar bus GainNode ducks under TTS
 * (driven by the session store's isPlaying, i.e. the W2 arbiter's playback
 * state, not a server hook).
 */

export interface RadarCue {
	id: number;
	category: string;
	bearingRad: number;
	distanceU: number;
	gain: number;
}

const DUCKED_GAIN = 0.15;
const IDLE_GAIN = 1;

interface CategorySound {
	freq: number;
	type: OscillatorType;
	durationS: number;
}

/** Distinct timbre per category — learnable, like Skyrim Access's cues. */
const CATEGORY_SOUNDS: Record<string, CategorySound> = {
	door: { freq: 140, type: "square", durationS: 0.12 },
	container: { freq: 420, type: "triangle", durationS: 0.09 },
	npc: { freq: 210, type: "sawtooth", durationS: 0.14 },
	flora: { freq: 640, type: "sine", durationS: 0.08 },
	furniture: { freq: 300, type: "triangle", durationS: 0.1 },
	activator: { freq: 500, type: "sine", durationS: 0.07 },
	other: { freq: 440, type: "sine", durationS: 0.08 },
};

let radarBus: GainNode | null = null;
let desiredDucked = false;
// Oscillators AND buffer sources share AudioScheduledSourceNode (has stop()).
let activeSources: AudioScheduledSourceNode[] = [];

export function ensureRadarBus(ctx: AudioContext): GainNode {
	if (radarBus) return radarBus;
	const bus = ctx.createGain();
	bus.gain.value = desiredDucked ? DUCKED_GAIN : IDLE_GAIN;
	bus.connect(ctx.destination);
	radarBus = bus;
	return bus;
}

/** TTS ducking — called from the session store on isPlaying changes. */
export function setRadarDucked(ctx: AudioContext | null, ducked: boolean): void {
	desiredDucked = ducked;
	if (!radarBus || !ctx) return;
	const target = ducked ? DUCKED_GAIN : IDLE_GAIN;
	try {
		radarBus.gain.setTargetAtTime(target, ctx.currentTime, 0.05);
	} catch {
		radarBus.gain.value = target;
	}
}

function stopPreviousSet(): void {
	for (const source of activeSources) {
		try {
			source.stop();
		} catch {
			// already finished
		}
	}
	activeSources = [];
}

function setPannerPosition(
	panner: PannerNode,
	x: number,
	y: number,
	z: number,
): void {
	try {
		panner.positionX.value = x;
		panner.positionY.value = y;
		panner.positionZ.value = z;
	} catch {
		// Older AudioContext API fallback.
		panner.setPosition(x, y, z);
	}
}

/** One sweep: stop the previous cue set, then place ≤8 one-shots in space. */
export function playRadarCues(ctx: AudioContext, cues: RadarCue[]): void {
	const bus = ensureRadarBus(ctx);
	stopPreviousSet();
	const now = ctx.currentTime;

	for (const cue of cues) {
		const sound = CATEGORY_SOUNDS[cue.category] ?? CATEGORY_SOUNDS.other!;
		const clampedBearing = Math.max(-Math.PI, Math.min(Math.PI, cue.bearingRad));
		const distance = Math.max(1, Math.min(1500, cue.distanceU));

		const osc = ctx.createOscillator();
		osc.type = sound.type;
		osc.frequency.value = sound.freq;

		const envelope = ctx.createGain();
		const peak = Math.max(0.02, cue.gain);
		envelope.gain.setValueAtTime(0.0001, now);
		envelope.gain.exponentialRampToValueAtTime(peak, now + 0.01);
		envelope.gain.exponentialRampToValueAtTime(0.0001, now + sound.durationS);

		const panner = ctx.createPanner();
		panner.panningModel = "HRTF";
		panner.distanceModel = "inverse";
		panner.refDistance = 200;
		panner.maxDistance = 1500;
		panner.rolloffFactor = 0.8;
		// Listener faces forward (-Z); 0 = front, +π/2 = right.
		setPannerPosition(
			panner,
			Math.sin(clampedBearing) * distance,
			0,
			-Math.cos(clampedBearing) * distance,
		);

		osc.connect(envelope);
		envelope.connect(panner);
		panner.connect(bus);

		osc.start(now);
		osc.stop(now + sound.durationS + 0.02);
		osc.onended = () => {
			try {
				osc.disconnect();
				envelope.disconnect();
				panner.disconnect();
			} catch {
				// already torn down
			}
		};
		activeSources.push(osc);
	}
}
