import { useEffect, useRef } from "react";
import { useAppStore } from "../stores/useAppStore";

export function TelemetryPanel() {
	const logs = useAppStore((s) => s.logs);
	const clearLogs = useAppStore((s) => s.clearLogs);
	const lastDescription = useAppStore((s) => s.lastDescription);
	const isPlaying = useAppStore((s) => s.isPlaying);
	const nowPlayingText = useAppStore((s) => s.nowPlayingText);
	const audioQueue = useAppStore((s) => s.audioQueue);
	const logRef = useRef<HTMLDivElement>(null);

	// Keep the stream pinned to the latest entries, like a console tail.
	useEffect(() => {
		const el = logRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [logs]);

	return (
		<section className="panel telemetry-panel" aria-label="Assistant telemetry">
			<div className="panel-head">
				<h2 className="panel-title">Assistant telemetry</h2>
				<button className="btn btn-ghost" onClick={clearLogs}>
					Clear
				</button>
			</div>
			<div className="panel-body">
				{lastDescription ? (
					<p className="observation">{lastDescription}</p>
				) : (
					<p className="observation-empty">
						No observation yet — silence is the default
					</p>
				)}

				<div className="audio-line">
					{isPlaying && nowPlayingText ? (
						<span className="playing">
							<span className="tag">now</span> {nowPlayingText}
						</span>
					) : (
						<span className="queued">
							<span className="tag">now</span> nothing playing
						</span>
					)}
					{audioQueue.length > 0 ? (
						audioQueue.map((item, i) => (
							<span key={i} className="queued">
								<span className="tag">
									next +{i + 1} · {item.priority}
								</span>{" "}
								{item.text}
							</span>
						))
					) : (
						<span className="queued">
							<span className="tag">queue</span> empty
						</span>
					)}
				</div>

				<div className="log-stream" ref={logRef}>
					{logs.map((log) => (
						<div
							key={log.id}
							className="log-row"
							data-level={log.level}
						>
							<span className="log-time">
								{new Date(log.timestamp).toLocaleTimeString()}
							</span>
							<span className="log-src">[{log.source}]</span>
							<span className="log-msg">{log.message}</span>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
