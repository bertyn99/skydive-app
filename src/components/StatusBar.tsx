import { useAppStore } from "../stores/useAppStore";

export function StatusBar() {
	const serverConnected = useAppStore((s) => s.serverConnected);
	const isCapturing = useAppStore((s) => s.isCapturing);
	const isPlaying = useAppStore((s) => s.isPlaying);
	const captureInterval = useAppStore((s) => s.captureInterval);
	const audioQueue = useAppStore((s) => s.audioQueue);
	const voiceStatus = useAppStore((s) => s.voiceStatus);
	const lastQuestion = useAppStore((s) => s.lastQuestion);

	const voiceLabel =
		voiceStatus === "wake-detected"
			? "wake"
			: voiceStatus === "listening"
				? "listening"
				: "off";

	return (
		<div className="status-strip" role="status" aria-label="Session status">
			<div className="status-cell">
				<span className="status-label">server</span>
				<span className="status-value">
					<span
						className="signal-dot"
						data-tone={serverConnected ? "ok" : "off"}
					/>
					<span>{serverConnected ? "online" : "offline"}</span>
				</span>
			</div>

			<div className="status-cell">
				<span className="status-label">capture</span>
				<span className="status-value">
					<span
						className="signal-dot"
						data-tone={isCapturing ? "live" : undefined}
					/>
					<span>
						{isCapturing ? `running · ${captureInterval}ms` : "idle"}
					</span>
				</span>
			</div>

			<div className="status-cell">
				<span className="status-label">audio</span>
				<span className="status-value">
					<span
						className="signal-dot"
						data-tone={isPlaying ? "ok" : undefined}
					/>
					<span>
						{isPlaying
							? "playing"
							: audioQueue.length > 0
								? `${audioQueue.length} queued`
								: "idle"}
					</span>
				</span>
			</div>

			<div className="status-cell">
				<span className="status-label">voice</span>
				<span className="status-value">
					<span
						className="signal-dot"
						data-tone={
							voiceStatus === "wake-detected"
								? "ok"
								: voiceStatus === "listening"
									? "warn"
									: undefined
						}
					/>
					<span>
						{voiceLabel}
						{lastQuestion && voiceStatus !== "off" && (
							<span title={lastQuestion}>
								{" "}
								— “
								{lastQuestion.length > 30
									? `${lastQuestion.slice(0, 30)}…`
									: lastQuestion}
								”
							</span>
						)}
					</span>
				</span>
			</div>
		</div>
	);
}
