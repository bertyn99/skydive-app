// Gemini cloud composer: compose-only call. The decision was made upstream
// (System 1 gate) — this provider only phrases the observation.

import { Output, generateText, type UserModelMessage } from "ai";
import {
	composerSystemMessages,
	composeSchema,
	type ComposeInput,
	type ComposeOutput,
} from "../config";
import { GEMINI_MODEL, GEMINI_MODEL_ID } from "../../utils/gemini";

export async function composeGeminiCloud(input: ComposeInput): Promise<ComposeOutput> {
	const { output } = await generateText({
		model: GEMINI_MODEL,
		output: Output.object({ schema: composeSchema, name: "skyguide_composer" }),
		abortSignal: AbortSignal.timeout(60_000),
		instructions: composerSystemMessages(input),
		messages: [composerUserMessage(input)],
	});
	return { ...output, modelId: GEMINI_MODEL_ID };
}

function composerUserMessage(input: ComposeInput): UserModelMessage {
	return {
		role: "user",
		content: [
			{ type: "file", data: input.clip.buffer, mediaType: input.clip.mediaType },
			{
				type: "text",
				text: input.question
					? `Question du joueur : « ${input.question} »`
					: "Formule l'observation (JSON strict).",
			},
		],
	};
}
