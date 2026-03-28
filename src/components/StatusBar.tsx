import { useAppStore } from "../stores/useAppStore";

export function StatusBar() {
	const serverConnected = useAppStore((s) => s.serverConnected);
	const isCapturing = useAppStore((s) => s.isCapturing);
	const isPlaying = useAppStore((s) => s.isPlaying);
	const captureInterval = useAppStore((s) => s.captureInterval);
	const audioQueue = useAppStore((s) => s.audioQueue);

	return (
		<div className="status-bar">
			<div className="status-item">
				<span
					className={`status-dot ${serverConnected ? "connected" : "disconnected"}`}
				/>
				Server
			</div>
			<div className="status-item">
				<span
					className={`status-dot ${isCapturing ? "connected" : "disconnected"}`}
				/>
				Capture ({captureInterval}ms)
			</div>
			<div className="status-item">
				<span className={`status-dot ${isPlaying ? "connected" : "idle"}`} />
				Audio{" "}
				{isPlaying
					? "Playing"
					: audioQueue.length > 0
						? `(${audioQueue.length} queued)`
						: "Idle"}
			</div>
		</div>
	);
}
