const CLIP_FRAME_TYPE = 1;
const AUDIO_FRAME_TYPE = 2;

const AUDIO_MIME_TYPES = [
	"audio/webm;codecs=opus",
	"audio/webm",
	"audio/ogg",
] as const;

function getAudioMimeId(mimeType: string): number {
	const normalized = mimeType.toLowerCase();
	const idx = AUDIO_MIME_TYPES.findIndex((value) => value === normalized);
	return idx === -1 ? 1 : idx;
}

export function buildClipFrame(
	videoBuffer: ArrayBuffer,
	durationMs: number,
): Uint8Array<ArrayBuffer> {
	const payload = new Uint8Array(videoBuffer);
	const frame = new Uint8Array(5 + payload.byteLength);
	frame[0] = CLIP_FRAME_TYPE;
	const view = new DataView(frame.buffer);
	view.setUint32(1, Math.max(0, durationMs), true);
	frame.set(payload, 5);
	return frame;
}

export function buildAudioFrame(
	audioBuffer: ArrayBuffer,
	mimeType: string,
): Uint8Array<ArrayBuffer> {
	const payload = new Uint8Array(audioBuffer);
	const frame = new Uint8Array(2 + payload.byteLength);
	frame[0] = AUDIO_FRAME_TYPE;
	frame[1] = getAudioMimeId(mimeType);
	frame.set(payload, 2);
	return frame;
}
