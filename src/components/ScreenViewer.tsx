import { useEffect, useRef } from "react";
import { useAppStore } from "../stores/useAppStore";

export function ScreenViewer() {
	const mediaStream = useAppStore((s) => s.mediaStream);
	const isCapturing = useAppStore((s) => s.isCapturing);
	const videoRef = useRef<HTMLVideoElement>(null);

	useEffect(() => {
		if (videoRef.current) {
			videoRef.current.srcObject = mediaStream;
		}
	}, [mediaStream]);

	return (
		<div className="panel screen-viewer">
			<h2>Screen Capture</h2>
			<div className="frame-container">
				{mediaStream ? (
					<video ref={videoRef} autoPlay muted playsInline />
				) : (
					<div className="placeholder">
						{isCapturing ? "Starting capture..." : "Capture stopped"}
					</div>
				)}
			</div>
		</div>
	);
}
