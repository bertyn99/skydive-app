import screenshot from "screenshot-desktop";

export interface CapturedFrame {
	base64: string;
	timestamp: number;
}

export async function captureScreen(): Promise<CapturedFrame> {
	const buffer = await screenshot({ format: "jpeg" });
	return {
		base64: buffer.toString("base64"),
		timestamp: Date.now(),
	};
}
