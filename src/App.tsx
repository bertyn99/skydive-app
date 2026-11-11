import { useEffect } from "react";
import { ConfigPanel } from "./components/ConfigPanel";
import { TelemetryPanel } from "./components/TelemetryPanel";
import { GameStatePanel } from "./components/GameStatePanel";
import { ScreenViewer } from "./components/ScreenViewer";
import { StatusBar } from "./components/StatusBar";
import { useAppStore } from "./stores/useAppStore";
import "./App.css";

function App() {
	const connect = useAppStore((s) => s.connect);
	const serverConnected = useAppStore((s) => s.serverConnected);

	useEffect(() => {
		connect();
	}, [connect]);

	return (
		<div className="console">
			<header className="command-bar">
				<div className="brand">
					<span className="brand-name">SkyGuide</span>
					<span className="brand-sub">Operator Console</span>
				</div>
				<div className="command-slot">
					<span
						className="signal-dot"
						data-tone={serverConnected ? "live" : "off"}
						aria-hidden="true"
					/>
					<span className="panel-meta">
						{serverConnected ? "LINK ONLINE" : "LINK OFFLINE"}
					</span>
				</div>
			</header>
			<StatusBar />
			<main className="console-grid">
				<ScreenViewer />
				<ConfigPanel />
				<TelemetryPanel />
				<GameStatePanel />
			</main>
		</div>
	);
}

export default App;
