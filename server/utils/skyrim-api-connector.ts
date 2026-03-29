import type {
	SkyrimAction,
	SkyrimConnector,
	SkyrimContext,
} from "./skyrim-connector";

// Base URL for the Skyrim mod REST API
const _baseUrl = process.env.SKYRIM_MOD_API_URL ?? "http://localhost:9920";

export class SkyrimApiConnector implements SkyrimConnector {
	async getContext(): Promise<SkyrimContext> {
		// TODO: GET {baseUrl}/context
		return { raw: null };
	}

	async sendAction(_action: SkyrimAction): Promise<{ success: boolean }> {
		// TODO: POST {baseUrl}/action
		return { success: false };
	}
}
