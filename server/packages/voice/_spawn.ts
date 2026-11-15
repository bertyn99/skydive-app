// Spawn-based availability probes shared by the voice providers. One
// implementation of the "does this command even run?" check that every
// local engine needs (piper, say, ffmpeg, the python piper module…).
import { spawn } from "node:child_process";

/**
 * True when `cmd args…` spawns successfully (exec found, binary runnable).
 * Kills the process immediately — probes never let work accumulate.
 */
export function spawnWorks(cmd: string, args: string[] = []): Promise<boolean> {
	return new Promise((resolve) => {
		const child = spawn(cmd, args, { stdio: "ignore" });
		child.once("error", () => resolve(false));
		child.once("spawn", () => {
			child.kill("SIGKILL");
			resolve(true);
		});
	});
}
