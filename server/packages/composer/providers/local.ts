// Self-hosted vision composer (Stage 6): any OpenAI-compatible endpoint
// (Ollama / LM Studio / vLLM) serving a vision model. The clip is sent as a
// `file` part carrying the webm data URL — ai@7 serializes that as a
// `video_url` content part on OpenAI-compatible endpoints. Stacks that only
// accept `image_url` (e.g. Ollama's documented surface) fail here and the
// service falls down its chain.

import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
	COMPOSER_LOCAL_API_KEY,
	COMPOSER_LOCAL_BASE_URL,
	COMPOSER_LOCAL_MODEL,
	COMPOSER_TIMEOUT_MS,
	composerSystemMessages,
	composerUserText,
	parseComposerJson,
	type ComposeInput,
	type ComposeOutput,
} from "../config";

// Built once — reads only env constants.
const provider = createOpenAICompatible({
	name: "composer-local",
	baseURL: COMPOSER_LOCAL_BASE_URL,
	apiKey: COMPOSER_LOCAL_API_KEY ?? "not-needed",
});

export async function composeLocal(input: ComposeInput): Promise<ComposeOutput> {
	const dataUrl = `data:${input.clip.mediaType};base64,${input.clip.buffer.toString("base64")}`;

	const { text } = await generateText({
		model: provider(COMPOSER_LOCAL_MODEL),
		abortSignal: AbortSignal.timeout(COMPOSER_TIMEOUT_MS),
		// Fast-fail: compose() falls down the chain on failure, so SDK retries
		// here would only add backoff latency before the fallback leg runs.
		maxRetries: 0,
		// The composer's system blocks (rules, mod context, history, intention)
		// are operator/trusted-app content; OpenAI-compatible APIs accept the
		// system role natively. ai@7 requires this explicit opt-in.
		allowSystemInMessages: true,
		messages: [
			...composerSystemMessages(input),
			{
				role: "user",
				content: [
					// `file` part (not the deprecated `image` part) — both serialize
					// to the same `video_url` wire part for a video/* data URL.
					{ type: "file", data: dataUrl, mediaType: input.clip.mediaType },
					{ type: "text", text: composerUserText(input) },
				],
			},
		],
	});

	return { ...parseComposerJson(text), modelId: COMPOSER_LOCAL_MODEL };
}
