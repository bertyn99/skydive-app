import { google } from "@ai-sdk/google";
import { generateText } from "ai";

const DEFAULT_SYSTEM_PROMPT =
	"You are an audio guide for a blind Skyrim player. Describe what you see concisely: enemies, items, terrain, UI elements. Prioritize threats and interactive objects. Be brief and actionable. Max 2-3 sentences.";

export async function describeFrame(
	base64: string,
	systemPrompt?: string,
): Promise<string> {
	const { text } = await generateText({
		model: google("gemini-2.0-flash"),
		system: systemPrompt || DEFAULT_SYSTEM_PROMPT,
		messages: [
			{
				role: "user",
				content: [
					{
						type: "image",
						image: Buffer.from(base64, "base64"),
						mimeType: "image/jpeg",
					},
					{
						type: "text",
						text: "Describe what is happening on screen right now.",
					},
				],
			},
		],
	});

	return text;
}
