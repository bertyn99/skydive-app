import { useAppStore } from "../stores/useAppStore";

export function DebugLogs() {
	const logs = useAppStore((s) => s.logs);
	const clearLogs = useAppStore((s) => s.clearLogs);
	const lastDescription = useAppStore((s) => s.lastDescription);

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
