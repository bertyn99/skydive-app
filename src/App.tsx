import { useEffect } from "react";
import { ConfigPanel } from "./components/ConfigPanel";
import { DebugLogs } from "./components/DebugLogs";
import { GameStatePanel } from "./components/GameStatePanel";
import { ScreenViewer } from "./components/ScreenViewer";
import { StatusBar } from "./components/StatusBar";
import { useAppStore } from "./stores/useAppStore";
import "./App.css";

function App() {
	const connect = useAppStore((s) => s.connect);

	useEffect(() => {
		connect();
	}, [connect]);

	return (
		<div className="dashboard">
			<header className="dashboard-header">
				<h1>Sky Guide</h1>
				<span className="subtitle">Skyrim Accessibility Assistant</span>
			</header>
			<StatusBar />
			<div className="dashboard-grid">
				<ScreenViewer />
				<ConfigPanel />
				<DebugLogs />
				<GameStatePanel />
			</div>
		</div>
	);
}

export default App;
