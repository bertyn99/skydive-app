import {
	Output,
	Mp4OutputFormat,
	BufferTarget,
	MediaStreamVideoTrackSource,
} from "mediabunny";

export async function startCapture(): Promise<MediaStream> {
	return navigator.mediaDevices.getDisplayMedia({
		video: {
			width: { ideal: 640 },
			frameRate: { ideal: 15 },
		},
	});
}

export async function recordClip(
	stream: MediaStream,
	durationMs: number,
): Promise<ArrayBuffer> {
	const target = new BufferTarget();
	const output = new Output({
		format: new Mp4OutputFormat(),
		target,
	});

	const videoTrack = stream.getVideoTracks()[0];
	const source = new MediaStreamVideoTrackSource(videoTrack, {
		codec: "avc",
		bitrate: 500_000,
	});
	source.errorPromise.catch(() => {});

	output.addVideoTrack(source);
	await output.start();

	await new Promise((r) => setTimeout(r, durationMs));

	source.close();
	await output.finalize();

	return target.buffer!;
}

export function stopCapture(stream: MediaStream) {
	stream.getTracks().forEach((t) => t.stop());
}
