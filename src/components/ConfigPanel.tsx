import { useState } from "react";
import { useAppStore } from "../stores/useAppStore";

export function ConfigPanel() {
	const isCapturing = useAppStore((s) => s.isCapturing);
	const captureInterval = useAppStore((s) => s.captureInterval);
	const serverConnected = useAppStore((s) => s.serverConnected);
	const sendCommand = useAppStore((s) => s.sendCommand);

	const [promptDraft, setPromptDraft] = useState("");

	const toggleCapture = () => {
		sendCommand(isCapturing ? "stop" : "start");
	};

	const handleIntervalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = Number(e.target.value);
		sendCommand("setInterval", value);
	};

	const handlePromptSave = () => {
		sendCommand("setPrompt", promptDraft);
	};

	return (
		<div className="panel config-panel">
			<h2>Configuration</h2>

			<div className="config-row">
				<label>Server</label>
				<span
					className={`status-dot ${serverConnected ? "connected" : "disconnected"}`}
				/>
				<span>{serverConnected ? "Connected" : "Disconnected"}</span>
			</div>

			<div className="config-row">
				<button
					className={`btn ${isCapturing ? "btn-danger" : "btn-primary"}`}
					onClick={toggleCapture}
					disabled={!serverConnected}
				>
					{isCapturing ? "Stop Capture" : "Start Capture"}
				</button>
			</div>

			<div className="config-row">
				<label>Capture Interval: {captureInterval}ms</label>
				<input
					type="range"
					min={1000}
					max={10000}
					step={500}
					value={captureInterval}
					onChange={handleIntervalChange}
					disabled={!serverConnected}
				/>
			</div>

			<div className="config-row">
				<label>System Prompt Override</label>
				<textarea
					value={promptDraft}
					onChange={(e) => setPromptDraft(e.target.value)}
					placeholder="Leave empty for default prompt..."
					rows={3}
				/>
				<button
					className="btn btn-secondary"
					onClick={handlePromptSave}
					disabled={!serverConnected}
				>
					Save Prompt
				</button>
			</div>
		</div>
	);
}
