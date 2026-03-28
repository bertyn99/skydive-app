import { defineEventHandler, readBody, createError } from "h3";
import type { GameStatePayload, GameStateResponse } from "../utils/protocol";
import { updateGameState } from "../utils/engine";

export default defineEventHandler(async (event) => {
	const body = await readBody<GameStatePayload>(event);

	if (body.protocolVersion !== 1) {
		throw createError({
			statusCode: 400,
			message: "Unsupported protocol version",
		});
	}

	if (!body.priority || !body.source || !body.data || !body.timestamp) {
		throw createError({
			statusCode: 400,
			message: "Missing required fields (priority, source, data, timestamp)",
		});
	}

	const geminiTriggered = updateGameState(body);

	const response: GameStateResponse = {
		status: "ok",
		geminiTriggered,
		serverTimestamp: Date.now(),
	};

	return response;
});
