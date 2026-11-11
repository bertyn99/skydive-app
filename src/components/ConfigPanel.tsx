import { useState } from "react";
import { useAppStore } from "../stores/useAppStore";

export function ConfigPanel() {
	const isCapturing = useAppStore((s) => s.isCapturing);
	const captureInterval = useAppStore((s) => s.captureInterval);
	const serverConnected = useAppStore((s) => s.serverConnected);
	const sendCommand = useAppStore((s) => s.sendCommand);
	const startCapture = useAppStore((s) => s.startCapture);
	const stopCapture = useAppStore((s) => s.stopCapture);

	const [promptDraft, setPromptDraft] = useState("");

	const toggleCapture = () => {
		if (isCapturing) {
			stopCapture();
		} else {
			startCapture();
		}
	};

	const handleIntervalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = Number(e.target.value);
		useAppStore.setState({ captureInterval: value });
		sendCommand("setInterval", value);
	};

	const handlePromptSave = () => {
		sendCommand("setPrompt", promptDraft);
	};

	return (
		<section className="panel rail-panel" aria-label="Session controls">
			<div className="panel-head">
				<h2 className="panel-title">Session</h2>
				<span className="panel-meta">
					{serverConnected ? "ready" : "no link"}
				</span>
			</div>
			<div className="panel-body">
				<div className="field-group">
					<button
						className={`btn ${isCapturing ? "btn-danger" : "btn-primary"}`}
						onClick={toggleCapture}
						disabled={!serverConnected}
					>
						{isCapturing ? "Stop capture" : "Start capture"}
					</button>
				</div>

				<div className="field-group">
					<label className="field-label" htmlFor="capture-interval">
						Clip interval
						<span className="value">{captureInterval}ms</span>
					</label>
					<input
						id="capture-interval"
						className="range"
						type="range"
						min={1000}
						max={10000}
						step={500}
						value={captureInterval}
						onChange={handleIntervalChange}
						disabled={!serverConnected}
					/>
				</div>

				<div className="field-group">
					<label className="field-label" htmlFor="system-prompt">
						System prompt override
					</label>
					<textarea
						id="system-prompt"
						className="textarea"
						value={promptDraft}
						onChange={(e) => setPromptDraft(e.target.value)}
						placeholder="Leave empty for default prompt…"
						rows={5}
					/>
					<button
						className="btn btn-secondary"
						onClick={handlePromptSave}
						disabled={!serverConnected}
					>
						Save prompt
					</button>
				</div>
			</div>
		</section>
	);
}
