import { defineEventHandler } from "h3";
import { stopWhisperServer } from "../../../utils/whisper-server";

/** Stops the whisper.cpp sidecar this app spawned (external servers are untouched). */
export default defineEventHandler(async () => {
	return stopWhisperServer();
});
