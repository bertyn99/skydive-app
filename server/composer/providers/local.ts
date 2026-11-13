// Self-hosted vision composer (Stage 6): any OpenAI-compatible endpoint
// (Ollama / LM Studio / vLLM) serving a vision model. Video goes up as a
// base64 data URL in an image part — stacks without inline-video support
// fail here and the service falls down its chain.

import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
	COMPOSER_LOCAL_API_KEY,
	COMPOSER_LOCAL_BASE_URL,
	COMPOSER_LOCAL_MODEL,
	COMPOSER_TIMEOUT_MS,
	composerSystemMessages,
	parseComposerJson,
	type ComposeInput,
	type ComposeOutput,
} from "../config";

export async function composeLocal(input: ComposeInput): Promise<ComposeOutput> {
	const provider = createOpenAICompatible({
		name: "composer-local",
		baseURL: COMPOSER_LOCAL_BASE_URL,
		apiKey: COMPOSER_LOCAL_API_KEY ?? "not-needed",
	});
	const dataUrl = `data:${input.clip.mediaType};base64,${input.clip.buffer.toString("base64")}`;

	const { text } = await generateText({
		model: provider(COMPOSER_LOCAL_MODEL),
		abortSignal: AbortSignal.timeout(COMPOSER_TIMEOUT_MS),
		messages: [
			...composerSystemMessages(input),
			{
				role: "user",
				content: [
					{ type: "image", image: dataUrl },
					{
						type: "text",
						text: input.question
							? `Question du joueur : « ${input.question} »`
							: "Formule l'observation (JSON strict selon le schéma système).",
					},
				],
			},
		],
	});

	return { ...parseComposerJson(text), modelId: COMPOSER_LOCAL_MODEL };
}
