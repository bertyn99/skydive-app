import { useAppStore } from "../stores/useAppStore";

export function ScreenViewer() {
	const currentFrame = useAppStore((s) => s.currentFrame);
	const isCapturing = useAppStore((s) => s.isCapturing);

	return (
		<div className="panel screen-viewer">
			<h2>Screen Capture</h2>
			<div className="frame-container">
				{currentFrame ? (
					<img
						src={`data:image/jpeg;base64,${currentFrame}`}
						alt="Game screen capture"
					/>
				) : (
					<div className="placeholder">
						{isCapturing ? "Waiting for first frame..." : "Capture stopped"}
					</div>
				)}
			</div>
		</div>
	);
}
