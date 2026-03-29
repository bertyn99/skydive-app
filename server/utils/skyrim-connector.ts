export interface SkyrimContext {
	raw: Record<string, unknown> | null;
}

export interface SkyrimAction {
	type: string;
	params: Record<string, unknown>;
}

export interface SkyrimConnector {
	getContext(): Promise<SkyrimContext>;
	sendAction(action: SkyrimAction): Promise<{ success: boolean }>;
}
