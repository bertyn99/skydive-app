import { useAppStore } from "../stores/useAppStore";

export function DebugLogs() {
	const logs = useAppStore((s) => s.logs);
	const clearLogs = useAppStore((s) => s.clearLogs);
	const lastDescription = useAppStore((s) => s.lastDescription);
	const isPlaying = useAppStore((s) => s.isPlaying);
	const nowPlayingText = useAppStore((s) => s.nowPlayingText);
	const audioQueue = useAppStore((s) => s.audioQueue);

	return (
		<div className="panel debug-logs">
			<div className="panel-header">
				<h2>Debug Logs</h2>
				<button className="btn btn-small" onClick={clearLogs}>
					Clear
				</button>
			</div>

			{lastDescription && (
				<div className="last-description">
					<strong>Last AI Description:</strong> {lastDescription}
				</div>
			)}

			<div
				className="audio-queue-debug"
				style={{
					padding: "8px 12px",
					fontSize: "0.85em",
					background: "var(--bg-tertiary, #1a1a2e)",
					borderRadius: 6,
					margin: "0 0 8px",
				}}
			>
				<strong>Audio Queue:</strong>
				<div style={{ marginTop: 4 }}>
					{isPlaying && nowPlayingText ? (
						<div>▶ Playing: {nowPlayingText}</div>
					) : (
						<div style={{ opacity: 0.5 }}>▶ Nothing playing</div>
					)}
					{audioQueue.length > 0 ? (
						audioQueue.map((item, i) => (
							<div key={i}>
								⏳ Next: [{item.priority}] {item.text}
							</div>
						))
					) : (
						<div style={{ opacity: 0.5 }}>⏳ Queue empty</div>
					)}
				</div>
			</div>

			<div className="log-list">
				{logs.map((log) => (
					<div key={log.id} className={`log-entry log-${log.level}`}>
						<span className="log-time">
							{new Date(log.timestamp).toLocaleTimeString()}
						</span>
						<span className="log-source">[{log.source}]</span>
						<span className="log-message">{log.message}</span>
					</div>
				))}
			</div>
		</div>
	);
}
