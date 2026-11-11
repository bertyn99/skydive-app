import { useEffect, useRef } from "react";
import { useAppStore } from "../stores/useAppStore";

export function ScreenViewer() {
	const mediaStream = useAppStore((s) => s.mediaStream);
	const isCapturing = useAppStore((s) => s.isCapturing);
	const captureInterval = useAppStore((s) => s.captureInterval);
	const videoRef = useRef<HTMLVideoElement>(null);

	useEffect(() => {
		if (videoRef.current) {
			videoRef.current.srcObject = mediaStream;
		}
	}, [mediaStream]);

	return (
		<section className="panel stage-panel" aria-label="Video stage">
			<div className="panel-head">
				<h2 className="panel-title">Stage · Source</h2>
				<span className="panel-meta">live session</span>
			</div>
			<div className="stage-body">
				<div className="stage-frame">
					{mediaStream ? (
						<video ref={videoRef} autoPlay muted playsInline />
					) : (
						<div className="stage-empty">
							<span className="stage-empty-title">No source</span>
							<span className="stage-empty-hint">
								{isCapturing
									? "Starting capture…"
									: "Start capture to feed the assistant from the screen."}
							</span>
						</div>
					)}
					<div className="hud" aria-hidden="true">
						<span className="hud-chip">
							{isCapturing && (
								<span className="rec-dot" aria-hidden="true" />
							)}
							{isCapturing ? "REC" : "STANDBY"}
						</span>
						<span className="hud-chip">CLIP {captureInterval}MS</span>
					</div>
				</div>
			</div>
		</section>
	);
}
